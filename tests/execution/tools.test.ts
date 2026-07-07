import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// http_fetch resolves hostnames for its SSRF guard — never hit real DNS in tests.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { lookup } from 'node:dns/promises';
import { createBuiltinTools, normalizeGrant } from '../../src/execution/tools.js';

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valor-tools-'));
});

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function allTools() {
  return createBuiltinTools({
    workspaceRoot,
    enabled: ['filesystem', 'shell', 'fetch'],
    disabled: [],
  });
}

describe('normalizeGrant', () => {
  it('strips markdown bold and em-dash descriptions', () => {
    expect(normalizeGrant('**Filesystem** — all development environments')).toBe('filesystem');
    expect(normalizeGrant('**Code execution** — TypeScript, Rust, Python runtimes')).toBe('code execution');
    expect(normalizeGrant('fetch')).toBe('fetch');
  });
});

describe('grants and aliases', () => {
  it('expands filesystem alias to file tools', () => {
    const tools = createBuiltinTools({ workspaceRoot, enabled: ['**Filesystem** — dev dirs'], disabled: [] });
    expect(tools.isEnabled('read_file')).toBe(true);
    expect(tools.isEnabled('write_file')).toBe(true);
    expect(tools.isEnabled('list_dir')).toBe(true);
    expect(tools.isEnabled('run_command')).toBe(false);
    expect(tools.isEnabled('http_fetch')).toBe(false);
  });

  it('grants nothing for unknown entries', () => {
    const tools = createBuiltinTools({
      workspaceRoot,
      enabled: ['**Claude Code** — primary development interface', '**Git** — full access'],
      disabled: [],
    });
    expect(tools.definitions!()).toHaveLength(0);
  });

  it('disabled wins over enabled', () => {
    const tools = createBuiltinTools({
      workspaceRoot,
      enabled: ['filesystem', 'shell'],
      disabled: ['**Shell** — too risky'],
    });
    expect(tools.isEnabled('run_command')).toBe(false);
    expect(tools.isEnabled('read_file')).toBe(true);
  });

  it('execute refuses tools that are not enabled', async () => {
    const tools = createBuiltinTools({ workspaceRoot, enabled: [], disabled: [] });
    const result = await tools.execute('read_file', { path: 'x.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not enabled');
  });

  it('definitions only advertises granted tools', () => {
    const tools = createBuiltinTools({ workspaceRoot, enabled: ['fetch'], disabled: [] });
    expect(tools.definitions!().map((d) => d.name)).toEqual(['http_fetch']);
  });
});

describe('read_file / write_file / list_dir', () => {
  it('writes then reads a file inside the workspace', async () => {
    const tools = allTools();
    const write = await tools.execute('write_file', { path: 'notes/hello.txt', content: 'hi there' });
    expect(write.success).toBe(true);

    const read = await tools.execute('read_file', { path: 'notes/hello.txt' });
    expect(read.success).toBe(true);
    expect(read.output).toBe('hi there');
  });

  it('lists directory entries with trailing slash for dirs', async () => {
    const tools = allTools();
    await tools.execute('write_file', { path: 'sub/a.txt', content: 'x' });
    await tools.execute('write_file', { path: 'b.txt', content: 'y' });

    const result = await tools.execute('list_dir', {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('sub/');
    expect(result.output).toContain('b.txt');
  });

  it('returns an error for a missing file', async () => {
    const tools = allTools();
    const result = await tools.execute('read_file', { path: 'nope.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('blocks path traversal out of the workspace', async () => {
    const tools = allTools();
    for (const p of ['../outside.txt', '..\\outside.txt', '/etc/passwd', 'a/../../outside.txt']) {
      const result = await tools.execute('read_file', { path: p });
      expect(result.success).toBe(false);
      expect(result.error).toContain('escapes');
    }
  });

  it('blocks path traversal on write', async () => {
    const tools = allTools();
    const result = await tools.execute('write_file', { path: '../evil.txt', content: 'x' });
    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, '..', 'evil.txt'))).toBe(false);
  });

  it('rejects invalid params', async () => {
    const tools = allTools();
    const result = await tools.execute('write_file', { path: 'x.txt' }); // missing content
    expect(result.success).toBe(false);
  });
});

describe('run_command', () => {
  it('runs a command in the workspace cwd and captures output', async () => {
    const tools = allTools();
    const result = await tools.execute('run_command', { command: 'echo hello-valor' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello-valor');
  });

  it('reports non-zero exit codes as failure', async () => {
    const tools = allTools();
    const result = await tools.execute('run_command', { command: 'exit 3' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('3');
  });
});

describe('http_fetch', () => {
  it('fetches a URL via GET and returns status + body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('pong', { status: 200 })));
    const tools = allTools();
    const result = await tools.execute('http_fetch', { url: 'https://example.com/ping' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('HTTP 200');
    expect(result.output).toContain('pong');
  });

  it('reports non-2xx responses as failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    const tools = allTools();
    const result = await tools.execute('http_fetch', { url: 'https://example.com/nope' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('rejects non-http URLs', async () => {
    const tools = allTools();
    const result = await tools.execute('http_fetch', { url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('blocks hosts that resolve to private addresses (SSRF)', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '192.168.1.10', family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 200 })));
    const tools = allTools();
    const result = await tools.execute('http_fetch', { url: 'https://internal.example.com/admin' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or loopback');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks literal loopback and private IPs without DNS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 200 })));
    const tools = allTools();
    for (const url of ['http://127.0.0.1:3200/health', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data']) {
      const result = await tools.execute('http_fetch', { url });
      expect(result.success).toBe(false);
      expect(result.error).toContain('private or loopback');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not follow redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/steal' } })
    ));
    const tools = allTools();
    const result = await tools.execute('http_fetch', { url: 'https://example.com/redir' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Redirects are not followed');
  });

  it('allowPrivateNetwork permits internal addresses when explicitly enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const tools = createBuiltinTools({
      workspaceRoot,
      enabled: ['fetch'],
      disabled: [],
      allowPrivateNetwork: true,
    });
    const result = await tools.execute('http_fetch', { url: 'http://127.0.0.1:11434/api/tags' });
    expect(result.success).toBe(true);
  });
});
