/**
 * Shared plumbing for CLI-backed provider adapters (codex, grok).
 *
 * These adapters run a locally installed, subscription-authenticated CLI as
 * the inference backend — no API keys. This module owns process spawning,
 * win32 PATHEXT/shell handling, timeouts, and output collection.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { ChatMessage } from "../types.js";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CliRunOptions {
  binPath: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  /** Written to the child's stdin, then stdin is closed. */
  stdin?: string;
  /**
   * Run via a shell. On win32 this lets a bare binary name resolve through
   * PATHEXT (Node's bare-name spawn does not) and tolerates .cmd/.bat shims.
   * Defaults to true on win32, else false.
   */
  shell?: boolean;
  spawn?: SpawnFn;
}

const FORCE_KILL_GRACE_MS = 5_000;

/**
 * Under shell mode Node joins argv unquoted, so quote any arg with whitespace
 * or shell-significant characters ourselves. cmd.exe strips the outer quote
 * pair, leaving ours; embedded double quotes are escaped by doubling.
 */
export function quoteShellArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  const shell = opts.shell ?? process.platform === "win32";
  const spawnFn = opts.spawn ?? (nodeSpawn as SpawnFn);
  const args = shell ? opts.args.map(quoteShellArg) : [...opts.args];

  return new Promise<CliRunResult>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn(opts.binPath, args, {
        cwd: opts.cwd,
        stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        shell,
        windowsHide: true,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    let settled = false;

    if (opts.stdin !== undefined && proc.stdin) {
      proc.stdin.on("error", () => { /* child exited before stdin drained */ });
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }

    proc.stdout?.on("data", (d: Buffer | string) => { stdoutChunks.push(d.toString()); });
    proc.stderr?.on("data", (d: Buffer | string) => { stderrChunks.push(d.toString()); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, FORCE_KILL_GRACE_MS).unref();
    }, opts.timeoutMs);
    timer.unref();

    const finalize = (exitCode: number | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (spawnError) {
        reject(spawnError);
        return;
      }
      resolve({
        exitCode,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        timedOut,
      });
    };

    proc.on("error", (err) => finalize(null, err));
    proc.on("exit", (code) => finalize(code));
  });
}

/**
 * Flatten a chat request into a single prompt string. CLI backends take one
 * prompt, not a message array; the system prompt and any prior turns are
 * rendered as labeled sections.
 */
export function flattenToPrompt(messages: readonly ChatMessage[], system?: string): string {
  const parts: string[] = [];
  if (system) {
    parts.push(`<system>\n${system}\n</system>`);
  }
  if (messages.length === 1 && messages[0]!.role === "user") {
    parts.push(messages[0]!.content);
  } else {
    for (const m of messages) {
      parts.push(`<${m.role}>\n${m.content}\n</${m.role}>`);
    }
    parts.push("Respond as the assistant to the conversation above.");
  }
  return parts.join("\n\n");
}

/** Last few lines of stderr for error messages, without dumping the full log. */
export function stderrTail(stderr: string, lines = 4): string {
  const tail = stderr.trim().split("\n").slice(-lines).join("\n").trim();
  return tail ? ` stderr: ${tail}` : "";
}
