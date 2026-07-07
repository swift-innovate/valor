import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createCodexCliAdapter, detectCodexCli } from '../../src/providers/adapters/codex-cli-adapter.js';
import { createGrokCliAdapter, detectGrokCli } from '../../src/providers/adapters/grok-cli-adapter.js';
import { quoteShellArg, flattenToPrompt } from '../../src/providers/adapters/cli-common.js';
import type { SpawnFn } from '../../src/providers/adapters/cli-common.js';

// ─── Fake child process ─────────────────────────────────────────────────────

interface FakeCall {
  command: string;
  args: readonly string[];
  stdin: string;
}

function fakeSpawn(opts: { stdout?: string; stderr?: string; exitCode?: number; delayMs?: number }, calls: FakeCall[] = []): SpawnFn {
  return (command, args) => {
    const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let stdinData = '';
    const call: FakeCall = { command, args, stdin: '' };
    calls.push(call);

    proc['stdout'] = stdout;
    proc['stderr'] = stderr;
    proc['stdin'] = {
      write: (d: string) => { stdinData += d; call.stdin = stdinData; return true; },
      end: () => {},
      on: () => {},
    };
    proc['kill'] = vi.fn(() => { proc.emit('exit', null); return true; });
    proc['killed'] = false;

    setTimeout(() => {
      if (opts.stdout) stdout.emit('data', opts.stdout);
      if (opts.stderr) stderr.emit('data', opts.stderr);
      proc.emit('exit', opts.exitCode ?? 0);
    }, opts.delayMs ?? 0);

    return proc as unknown as ChildProcess;
  };
}

const CODEX_JSONL = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello from codex"}}',
  '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":15}}',
].join('\n');

const GROK_JSON = JSON.stringify({
  text: 'Hello from grok',
  stopReason: 'EndTurn',
  sessionId: 's-123',
});

const REQUEST = {
  model: '',
  messages: [{ role: 'user' as const, content: 'Say hello' }],
  system: 'You are terse.',
};

// ─── cli-common ─────────────────────────────────────────────────────────────

describe('quoteShellArg', () => {
  it('leaves simple args untouched and quotes whitespace/specials', () => {
    expect(quoteShellArg('--version')).toBe('--version');
    expect(quoteShellArg('two words')).toBe('"two words"');
    expect(quoteShellArg('a"b')).toBe('"a""b"');
    expect(quoteShellArg('')).toBe('""');
  });
});

describe('flattenToPrompt', () => {
  it('passes a single user message through with the system section', () => {
    const out = flattenToPrompt([{ role: 'user', content: 'hi' }], 'sys');
    expect(out).toContain('<system>\nsys\n</system>');
    expect(out).toContain('hi');
    expect(out).not.toContain('<user>');
  });

  it('labels multi-turn conversations', () => {
    const out = flattenToPrompt([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    expect(out).toContain('<assistant>\na1\n</assistant>');
    expect(out).toContain('Respond as the assistant');
  });
});

// ─── Codex adapter ──────────────────────────────────────────────────────────

describe('codex CLI adapter', () => {
  it('parses agent messages and real token usage from JSONL', async () => {
    const calls: FakeCall[] = [];
    const adapter = createCodexCliAdapter({ spawn: fakeSpawn({ stdout: CODEX_JSONL }, calls) });

    const res = await adapter.complete({ ...REQUEST });
    expect(res.content).toBe('Hello from codex');
    expect(res.usage).toEqual({ input_tokens: 120, output_tokens: 15 });
    expect(res.stop_reason).toBe('end_turn');

    // Prompt travels via stdin; sandbox flags are read-only + ephemeral
    expect(calls[0]!.stdin).toContain('Say hello');
    expect(calls[0]!.stdin).toContain('<system>');
    const flat = calls[0]!.args.join(' ');
    expect(flat).toContain('exec');
    expect(flat).toContain('read-only');
    expect(flat).toContain('--ephemeral');
  });

  it('omits -m for the bare "codex" model and passes explicit models', async () => {
    const calls: FakeCall[] = [];
    const spawn = fakeSpawn({ stdout: CODEX_JSONL }, calls);
    const adapter = createCodexCliAdapter({ spawn });

    await adapter.complete({ ...REQUEST, model: 'codex' });
    expect(calls[0]!.args).not.toContain('-m');

    await adapter.complete({ ...REQUEST, model: 'gpt-5.2-codex' });
    expect(calls[1]!.args).toContain('-m');
    expect(calls[1]!.args).toContain('gpt-5.2-codex');
  });

  it('throws with stderr tail on non-zero exit', async () => {
    const adapter = createCodexCliAdapter({
      spawn: fakeSpawn({ stdout: '', stderr: 'not logged in\nrun codex login', exitCode: 1 }),
    });
    await expect(adapter.complete({ ...REQUEST })).rejects.toThrow(/exited with code 1.*codex login/s);
  });

  it('throws when output has no agent message', async () => {
    const adapter = createCodexCliAdapter({
      spawn: fakeSpawn({ stdout: '{"type":"turn.completed","usage":{}}' }),
    });
    await expect(adapter.complete({ ...REQUEST })).rejects.toThrow(/no agent message/);
  });

  it('times out and reports it', async () => {
    const adapter = createCodexCliAdapter({
      timeoutMs: 30,
      spawn: fakeSpawn({ stdout: CODEX_JSONL, delayMs: 10_000 }),
    });
    await expect(adapter.complete({ ...REQUEST })).rejects.toThrow(/timed out/);
  });

  it('healthCheck maps --version success to healthy', async () => {
    const adapter = createCodexCliAdapter({ spawn: fakeSpawn({ stdout: 'codex-cli 0.142.5' }) });
    const health = await adapter.healthCheck();
    expect(health.status).toBe('healthy');
  });

  it('detectCodexCli returns false when spawn fails', async () => {
    const failingSpawn: SpawnFn = () => { throw new Error('ENOENT'); };
    expect(await detectCodexCli('codex', failingSpawn)).toBe(false);
  });

  it('advertises its model list for registry routing', () => {
    const adapter = createCodexCliAdapter({ models: ['codex', 'gpt-5.2'] });
    expect(adapter.capabilities.models).toEqual(['codex', 'gpt-5.2']);
    expect(adapter.capabilities.toolUse).toBe(false);
  });
});

// ─── Grok adapter ───────────────────────────────────────────────────────────

describe('grok CLI adapter', () => {
  it('parses the JSON result', async () => {
    const calls: FakeCall[] = [];
    const adapter = createGrokCliAdapter({ spawn: fakeSpawn({ stdout: GROK_JSON }, calls) });

    const res = await adapter.complete({ ...REQUEST });
    expect(res.content).toBe('Hello from grok');
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0 });

    const flat = calls[0]!.args.join(' ');
    expect(flat).toContain('--output-format json');
    expect(flat).toContain('--disable-web-search');
    expect(flat).toContain('--max-turns 1');
    expect(flat).toContain('Say hello');
    // System prompt travels via the CLI flag, not the -p prompt
    expect(calls[0]!.args).toContain('--system-prompt-override');
    const pIdx = calls[0]!.args.indexOf('-p');
    expect(calls[0]!.args[pIdx + 1]).not.toContain('You are terse.');
  });

  it('tolerates auth-worker noise before the JSON', async () => {
    const adapter = createGrokCliAdapter({
      spawn: fakeSpawn({ stdout: 'auth worker ready\n' + GROK_JSON }),
    });
    const res = await adapter.complete({ ...REQUEST });
    expect(res.content).toBe('Hello from grok');
  });

  it('omits --model for the bare "grok" model and passes explicit models', async () => {
    const calls: FakeCall[] = [];
    const spawn = fakeSpawn({ stdout: GROK_JSON }, calls);
    const adapter = createGrokCliAdapter({ spawn });

    await adapter.complete({ ...REQUEST, model: 'grok' });
    expect(calls[0]!.args).not.toContain('--model');

    await adapter.complete({ ...REQUEST, model: 'grok-build' });
    expect(calls[1]!.args).toContain('--model');
    expect(calls[1]!.args).toContain('grok-build');
  });

  it('throws when exit 0 but no text field', async () => {
    const adapter = createGrokCliAdapter({
      spawn: fakeSpawn({ stdout: '{"stopReason":"EndTurn"}' }),
    });
    await expect(adapter.complete({ ...REQUEST })).rejects.toThrow(/no text/);
  });

  it('throws with stderr tail on non-zero exit', async () => {
    const adapter = createGrokCliAdapter({
      spawn: fakeSpawn({ stdout: '', stderr: 'subscription required', exitCode: 2 }),
    });
    await expect(adapter.complete({ ...REQUEST })).rejects.toThrow(/exited with code 2.*subscription/s);
  });

  it('detectGrokCli returns true on --version success', async () => {
    expect(await detectGrokCli('grok', fakeSpawn({ stdout: 'grok 0.2.87' }))).toBe(true);
  });

  it('stream yields token then completion', async () => {
    const adapter = createGrokCliAdapter({ spawn: fakeSpawn({ stdout: GROK_JSON }) });
    const events = [];
    for await (const e of adapter.stream({ ...REQUEST })) events.push(e);
    expect(events.map((e) => e.event_type)).toEqual(['token', 'completion']);
  });
});
