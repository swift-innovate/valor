/**
 * Built-in tool adapter for the operative loop's Act phase.
 *
 * Tools are granted per-agent via tools.md (parsed by AgentLoader into
 * config.tools.enabled/disabled). Entries are human-readable names —
 * an alias layer maps them onto canonical built-ins, and anything that
 * doesn't match an alias grants nothing (safe by default).
 *
 * All filesystem tools are jailed to a per-agent workspace root.
 * run_command executes with the workspace as cwd — it is NOT a sandbox;
 * grant "code execution"/"shell" only to agents you trust with the host.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ToolDefinition } from '../providers/types.js';
import type { ToolAdapter, ToolResult } from './types.js';

export interface BuiltinToolsOptions {
  /** Root directory all filesystem tools are jailed to; cwd for run_command. */
  workspaceRoot: string;
  /** Grant list — raw tools.md entries or canonical tool names. */
  enabled: readonly string[];
  /** Deny list — same format; wins over enabled. */
  disabled: readonly string[];
  /** Max wall-clock for run_command (default 30s, hard cap 120s). */
  commandTimeoutMs?: number;
  /**
   * Allow http_fetch to reach loopback/RFC1918/link-local addresses.
   * Default false — blocks SSRF against internal services. Enable only
   * for agents that legitimately need to call in-network APIs.
   */
  allowPrivateNetwork?: boolean;
}

const OUTPUT_CAP = 10_000; // chars returned to the model per tool result
const READ_CAP = 20_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 15_000;

// ─── Grant aliases ──────────────────────────────────────────────────────────
// tools.md entries are prose ("**Filesystem** — all development environments").
// normalizeGrant() reduces an entry to its lowercase name; TOOL_ALIASES maps
// names to the canonical built-ins they grant.

const TOOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  filesystem: ['read_file', 'write_file', 'list_dir'],
  read_file: ['read_file'],
  write_file: ['write_file'],
  list_dir: ['list_dir'],
  'code execution': ['run_command'],
  shell: ['run_command'],
  run_command: ['run_command'],
  fetch: ['http_fetch'],
  http: ['http_fetch'],
  http_fetch: ['http_fetch'],
  web: ['http_fetch'],
};

/** Reduce a tools.md bullet ("**Filesystem** — dev dirs") to a lookup key. */
export function normalizeGrant(entry: string): string {
  return entry
    .split('—')[0]          // drop the description after the em-dash
    .split(' - ')[0]        // or a hyphen-style description
    .replace(/\*\*/g, '')   // strip markdown bold
    .trim()
    .toLowerCase();
}

function expandGrants(entries: readonly string[]): Set<string> {
  const granted = new Set<string>();
  for (const entry of entries) {
    const aliases = TOOL_ALIASES[normalizeGrant(entry)];
    if (aliases) {
      for (const tool of aliases) granted.add(tool);
    }
  }
  return granted;
}

// ─── Path jail ──────────────────────────────────────────────────────────────

function resolveJailed(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${p}" escapes the agent workspace`);
  }
  return abs;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated at ${cap} chars]` : text;
}

// ─── Param schemas ──────────────────────────────────────────────────────────

const ReadFileParams = z.object({ path: z.string().min(1) });
const WriteFileParams = z.object({ path: z.string().min(1), content: z.string() });
const ListDirParams = z.object({ path: z.string().default('.') });
const RunCommandParams = z.object({
  command: z.string().min(1),
  timeout_ms: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_MS).optional(),
});
const HttpFetchParams = z.object({ url: z.string().url() });

// ─── Tool definitions (advertised to the model) ─────────────────────────────

const DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a text file from the agent workspace. Params: path (relative to workspace).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the workspace' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a text file in the agent workspace (atomic, creates parent dirs). Params: path, content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries in a workspace directory. Params: path (optional, defaults to workspace root).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path relative to the workspace' } },
      required: [],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command with the workspace as working directory. Params: command, timeout_ms (optional).',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (max 120000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'http_fetch',
    description: 'HTTP GET a URL and return the response body (capped). Params: url (http/https only).',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The http(s) URL to fetch' } },
      required: ['url'],
    },
  },
];

// ─── Tool implementations ───────────────────────────────────────────────────

function readFileTool(root: string, params: z.infer<typeof ReadFileParams>): ToolResult {
  const abs = resolveJailed(root, params.path);
  if (!fs.existsSync(abs)) {
    return { success: false, output: '', error: `File not found: ${params.path}` };
  }
  return { success: true, output: truncate(fs.readFileSync(abs, 'utf-8'), READ_CAP) };
}

function writeFileTool(root: string, params: z.infer<typeof WriteFileParams>): ToolResult {
  const abs = resolveJailed(root, params.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, params.content, 'utf-8');
  fs.renameSync(tmp, abs);
  return { success: true, output: `Wrote ${params.content.length} chars to ${params.path}` };
}

function listDirTool(root: string, params: z.infer<typeof ListDirParams>): ToolResult {
  const abs = resolveJailed(root, params.path);
  if (!fs.existsSync(abs)) {
    return { success: false, output: '', error: `Directory not found: ${params.path}` };
  }
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  return { success: true, output: truncate(entries.join('\n') || '(empty)', OUTPUT_CAP) };
}

function runCommandTool(
  root: string,
  params: z.infer<typeof RunCommandParams>,
  defaultTimeoutMs: number
): Promise<ToolResult> {
  const timeout = Math.min(params.timeout_ms ?? defaultTimeoutMs, MAX_COMMAND_TIMEOUT_MS);
  return new Promise((resolve) => {
    const child = spawn(params.command, { shell: true, cwd: root, timeout });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', (err) => {
      resolve({ success: false, output: truncate(out, OUTPUT_CAP), error: err.message });
    });
    child.on('close', (code, signal) => {
      const timedOut = signal !== null;
      resolve({
        success: code === 0,
        output: truncate(out, OUTPUT_CAP),
        ...(code !== 0
          ? { error: timedOut ? `Command timed out after ${timeout}ms` : `Exit code ${code}` }
          : {}),
      });
    });
  });
}

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const a = parts[0]!;
  const b = parts[1]!;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) ||           // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateAddress(addr: string): boolean {
  if (net.isIPv4(addr)) return ipv4IsPrivate(addr);
  const lower = addr.toLowerCase();
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (v4Mapped) return ipv4IsPrivate(v4Mapped[1]!);
  return (
    lower === '::' || lower === '::1' ||
    lower.startsWith('fc') || lower.startsWith('fd') ||  // ULA fc00::/7
    /^fe[89ab]/.test(lower)                              // link-local fe80::/10
  );
}

async function httpFetchTool(
  params: z.infer<typeof HttpFetchParams>,
  allowPrivateNetwork: boolean
): Promise<ToolResult> {
  const url = new URL(params.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { success: false, output: '', error: `Unsupported protocol: ${url.protocol}` };
  }

  // SSRF guard: resolve the host and refuse private/loopback/link-local
  // destinations unless explicitly allowed. (DNS-rebinding TOCTOU is
  // acknowledged — full pinning would need a custom agent; this blocks
  // the practical cases for an LLM-driven tool.)
  if (!allowPrivateNetwork) {
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (net.isIP(hostname)) {
      addresses = [hostname];
    } else {
      try {
        const results = await lookup(hostname, { all: true, verbatim: true });
        addresses = results.map((r) => r.address);
      } catch {
        return { success: false, output: '', error: `DNS resolution failed for ${hostname}` };
      }
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      return {
        success: false,
        output: '',
        error: `Refusing to fetch ${hostname}: resolves to a private or loopback address`,
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are not followed — each hop would need re-validation.
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      return {
        success: false,
        output: `HTTP ${res.status} → ${res.headers.get('location') ?? '(no location)'}`,
        error: 'Redirects are not followed; fetch the target URL directly',
      };
    }
    const body = truncate(await res.text(), OUTPUT_CAP);
    return {
      success: res.ok,
      output: `HTTP ${res.status}\n${body}`,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Adapter factory ────────────────────────────────────────────────────────

export function createBuiltinTools(opts: BuiltinToolsOptions): ToolAdapter {
  const granted = expandGrants(opts.enabled);
  for (const denied of expandGrants(opts.disabled)) {
    granted.delete(denied);
  }
  const commandTimeout = opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  const adapter: ToolAdapter = {
    isEnabled(tool: string): boolean {
      return granted.has(tool);
    },

    definitions(): ToolDefinition[] {
      return DEFINITIONS.filter((d) => granted.has(d.name));
    },

    async execute(tool: string, params: Record<string, unknown>): Promise<ToolResult> {
      if (!granted.has(tool)) {
        return { success: false, output: '', error: `Tool "${tool}" is not enabled for this agent` };
      }
      try {
        switch (tool) {
          case 'read_file':
            return readFileTool(opts.workspaceRoot, ReadFileParams.parse(params));
          case 'write_file':
            return writeFileTool(opts.workspaceRoot, WriteFileParams.parse(params));
          case 'list_dir':
            return listDirTool(opts.workspaceRoot, ListDirParams.parse(params));
          case 'run_command':
            return await runCommandTool(opts.workspaceRoot, RunCommandParams.parse(params), commandTimeout);
          case 'http_fetch':
            return await httpFetchTool(HttpFetchParams.parse(params), opts.allowPrivateNetwork ?? false);
          default:
            return { success: false, output: '', error: `Unknown tool "${tool}"` };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('Tool execution failed', { tool, error: message });
        return { success: false, output: '', error: message };
      }
    },
  };

  return adapter;
}
