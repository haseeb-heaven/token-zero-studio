import { describe, expect, it } from 'vitest';
import { getAgent } from '../src/core/agents';
import { defaultProfile } from '../src/core/config';
import { getProxy } from '../src/core/proxies/registry';
import {
  FetchFn,
  ProcessManager,
  SpawnFn,
  SpawnedProcess,
  buildAgentEnv,
  buildLaunchPlan,
  buildProxyArgs,
  buildTerminalCommand,
  quoteArg,
  resolveAgentBinary,
  splitArgs,
} from '../src/core/launcher';
import { ProxyManager, waitForProxyReady } from '../src/core/proxy-manager';
import { Logger } from '../src/core/logger';
import type { ScanResult } from '../src/shared/types';

/* ------------------------------ pure builders ------------------------------ */

describe('splitArgs', () => {
  it('splits on whitespace and respects quotes', () => {
    expect(splitArgs('--resume')).toEqual(['--resume']);
    expect(splitArgs('--model "gpt 5" -i')).toEqual(['--model', 'gpt 5', '-i']);
    expect(splitArgs("-m 'hello world'")).toEqual(['-m', 'hello world']);
    expect(splitArgs('')).toEqual([]);
    expect(splitArgs('   ')).toEqual([]);
  });
});

describe('buildProxyArgs', () => {
  const headroom = getProxy('headroom');

  it('builds the full flag set from a profile', () => {
    const p = { ...defaultProfile('codex'), port: 8989, mode: 'token' as const };
    expect(buildProxyArgs(headroom, p)).toEqual([
      'proxy', '--port', '8989', '--mode', 'token', '--memory', '--learn',
    ]);
  });

  it('honours toggles and extra args', () => {
    const p = {
      ...defaultProfile('claude'),
      memory: false,
      learn: false,
      lossless: true,
      noOptimize: true,
      extraProxyArgs: '--rpm 120 --no-cache',
    };
    expect(buildProxyArgs(headroom, p)).toEqual([
      'proxy', '--port', '8798', '--mode', 'cache', '--no-optimize', '--lossless',
      '--rpm', '120', '--no-cache',
    ]);
  });
});

describe('buildAgentEnv', () => {
  const headroom = getProxy('headroom');

  it('sets ANTHROPIC_BASE_URL for anthropic-style agents (no /v1)', () => {
    const env = buildAgentEnv(getAgent('claude'), { ...defaultProfile('claude'), port: 8798 }, headroom);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8798');
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });

  it('sets OPENAI_BASE_URL with /v1 for openai-style agents', () => {
    const env = buildAgentEnv(getAgent('codex'), { ...defaultProfile('codex'), port: 8989 }, headroom);
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8989/v1');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('sets both for dual-style agents (matches run_grok/run_cline scripts)', () => {
    const env = buildAgentEnv(getAgent('grok'), { ...defaultProfile('grok'), port: 8791 }, headroom);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8791');
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8791/v1');
  });

  it('mirrors HEADROOM_MEMORY / HEADROOM_LEARN and applies env overrides last', () => {
    const p = {
      ...defaultProfile('cline'),
      memory: true,
      learn: false,
      envOverrides: { ANTHROPIC_BASE_URL: 'http://custom:1', EXTRA: 'yes' },
    };
    const env = buildAgentEnv(getAgent('cline'), p, headroom);
    expect(env.HEADROOM_MEMORY).toBe('true');
    expect(env.HEADROOM_LEARN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe('http://custom:1');
    expect(env.EXTRA).toBe('yes');
  });
});

describe('resolveAgentBinary', () => {
  const scan: ScanResult = { agentId: 'codex', found: true, paths: ['/usr/local/bin/codex'], source: 'path' };

  it('prefers the explicit profile path', () => {
    const p = { ...defaultProfile('codex'), agentPath: '  D:\\custom\\codex.exe ' };
    expect(resolveAgentBinary(p, scan)).toBe('D:\\custom\\codex.exe');
  });

  it('falls back to the first scan hit', () => {
    expect(resolveAgentBinary(defaultProfile('codex'), scan)).toBe(
      '/usr/local/bin/codex',
    );
  });

  it('returns null when nothing is known', () => {
    expect(resolveAgentBinary(defaultProfile('codex'), undefined)).toBeNull();
  });
});

describe('buildLaunchPlan', () => {
  const headroom = getProxy('headroom');

  it('assembles a complete plan', () => {
    const p = { ...defaultProfile('codex'), extraAgentArgs: '--resume "abc 1"' };
    const plan = buildLaunchPlan(getAgent('codex'), p, headroom, '/hb/headroom', '/usr/bin/codex');
    expect(plan.agentId).toBe('codex');
    expect(plan.headroomBin).toBe('/hb/headroom');
    expect(plan.proxyArgs[0]).toBe('proxy');
    expect(plan.agentBin).toBe('/usr/bin/codex');
    expect(plan.agentArgs).toEqual(['--resume', 'abc 1']);
    expect(plan.env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8989/v1');
    expect(plan.strategy).toBe('env');
  });

  it('throws for env-strategy agents without a binary', () => {
    expect(() => buildLaunchPlan(getAgent('codex'), defaultProfile('codex'), headroom, '/hb/headroom', null)).toThrow(
      /requires an executable/,
    );
  });

  it('allows instructions-strategy agents without a binary', () => {
    const plan = buildLaunchPlan(getAgent('continue'), defaultProfile('continue'), headroom, '/hb/headroom', null);
    expect(plan.strategy).toBe('instructions');
    expect(plan.agentBin).toBe('');
  });

  it('uses the configured working directory', () => {
    const p = { ...defaultProfile('codex'), workingDirectory: 'D:\\Code\\proj' };
    const plan = buildLaunchPlan(getAgent('codex'), p, headroom, '/hb/headroom', '/usr/bin/codex');
    expect(plan.cwd).toBe('D:\\Code\\proj');
  });
});

describe('quoteArg', () => {
  it('double-quotes on Windows', () => {
    expect(quoteArg('C:\\a b\\x.exe', 'win32')).toBe('"C:\\a b\\x.exe"');
  });
  it('single-quotes with escaping on POSIX', () => {
    expect(quoteArg("/a b/x's", 'linux')).toBe("'/a b/x'\\''s'");
  });
});

describe('buildTerminalCommand', () => {
  const headroom = getProxy('headroom');
  const plan = buildLaunchPlan(
    getAgent('codex'),
    { ...defaultProfile('codex'), workingDirectory: '/work' },
    headroom,
    '/hb/headroom',
    '/usr/bin/codex',
  );

  it('uses cmd start on Windows', () => {
    const winPlan = { ...plan, agentBin: 'C:\\bin\\codex.exe', cwd: 'D:\\work' };
    const t = buildTerminalCommand(winPlan, 'Codex', 'win32');
    expect(t.cmd).toBe('cmd.exe');
    expect(t.args[0]).toBe('/c');
    expect(t.args[1]).toBe('start');
    expect(t.args).toContain('/D');
    expect(t.args).toContain('D:\\work');
    expect(t.args[t.args.length - 1]).toContain('C:\\bin\\codex.exe');
  });

  it('uses osascript Terminal on macOS with exported env', () => {
    const t = buildTerminalCommand(plan, 'Codex', 'darwin');
    expect(t.cmd).toBe('osascript');
    expect(t.args[1]).toContain('tell application "Terminal"');
    expect(t.args[1]).toContain('OPENAI_BASE_URL');
    expect(t.args[1]).toContain('/usr/bin/codex');
  });

  it('uses a terminal emulator on Linux (gnome-terminal gets --)', () => {
    const t = buildTerminalCommand(plan, 'Codex', 'linux', { terminal: 'gnome-terminal' });
    expect(t.cmd).toBe('gnome-terminal');
    expect(t.args[0]).toBe('--');
    expect(t.args.slice(1)).toEqual(['bash', '-c', expect.stringContaining('codex')]);
    const x = buildTerminalCommand(plan, 'Codex', 'linux', { terminal: 'xterm' });
    expect(x.args[0]).toBe('-e');
  });
});

/* ---------------------------- waitForProxyReady ---------------------------- */

describe('waitForProxyReady', () => {
  const noSleep = () => Promise.resolve();

  it('resolves true as soon as any endpoint answers', async () => {
    let calls = 0;
    const fetch: FetchFn = async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return { status: 200 };
    };
    expect(await waitForProxyReady(8989, 5000, fetch, noSleep)).toBe(true);
  });

  it('any HTTP status counts as ready (404 on /livez is fine)', async () => {
    const fetch: FetchFn = async () => ({ status: 404 });
    expect(await waitForProxyReady(8989, 1000, fetch, noSleep)).toBe(true);
  });

  it('times out when nothing answers', async () => {
    const fetch: FetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    const t0 = Date.now();
    expect(await waitForProxyReady(8989, 300, fetch, noSleep, 50)).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
  });
});

/* ----------------------------- ProcessManager ------------------------------ */

function fakeSpawn(behavior?: {
  onSpawn?: (cmd: string, args: string[]) => void;
}): { spawn: SpawnFn; spawned: { cmd: string; args: string[]; proc: SpawnedProcess }[] } {
  const spawned: { cmd: string; args: string[]; proc: SpawnedProcess }[] = [];
  const spawn: SpawnFn = (cmd, args) => {
    const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
    const proc: SpawnedProcess = {
      pid: 1000 + spawned.length,
      stdout: null,
      stderr: null,
      on: (event, cb) => {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      },
      kill: () => {
        for (const cb of listeners.get('exit') ?? []) cb(0);
      },
    };
    spawned.push({ cmd, args: [...args], proc });
    behavior?.onSpawn?.(cmd, args);
    return proc;
  };
  return { spawn, spawned };
}

const readyFetch: FetchFn = async () => ({ status: 200 });
const failFetch: FetchFn = async () => {
  throw new Error('ECONNREFUSED');
};
const noSleep = () => Promise.resolve();

const headroom = getProxy('headroom');

function makePlan(agentId = 'codex') {
  const agent = getAgent(agentId);
  const profile = defaultProfile(agentId);
  return buildLaunchPlan(agent, profile, headroom, '/hb/headroom', agent.launchStrategy === 'env' ? '/usr/bin/' + agentId : null);
}

function makeProxyManager(spawn?: SpawnFn, fetch: FetchFn = readyFetch) {
  const s = spawn ?? fakeSpawn().spawn;
  return new ProxyManager({ spawn: s, fetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });
}

describe('ProcessManager', () => {
  it('runs the full lifecycle: starting -> proxy-up -> running, spawning proxy then agent terminal', async () => {
    const { spawn, spawned } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });
    const states: string[] = [];
    pm.onRuntimeChange((r) => states.push(r.state));

    const runtime = await pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    expect(runtime.state).toBe('running');
    expect(spawned[0].cmd).toBe('/hb/headroom');
    expect(spawned[0].args[0]).toBe('proxy');
    expect(spawned[1].cmd).toBe('xterm'); // agent in a new terminal
    expect(states).toEqual(['starting', 'proxy-up', 'running']);
  });

  it('stops at proxy-up for instructions-strategy agents and never spawns an agent', async () => {
    const { spawn, spawned } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', proxyManager });
    const runtime = await pm.start(makePlan('continue'), headroom, '/hb/headroom', headroom.defaultFlags, 'Continue', 5000);
    expect(runtime.state).toBe('proxy-up');
    expect(spawned.length).toBe(1);
  });

  it('fails with cleanup when the proxy never becomes ready', async () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn, failFetch);
    const pm = new ProcessManager({ spawn, fetch: failFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', proxyManager });
    await expect(pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 300)).rejects.toThrow(/did not become ready/);
    expect(pm.runtimeFor('codex').state).toBe('error');
  });

  it('refuses to start twice while running', async () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager();
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });
    await pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await expect(pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000)).rejects.toThrow(/already/);
  });

  it('stop kills agent and proxy and reports stopped', async () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager();
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });
    await pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    const stopped = pm.stop('codex');
    expect(stopped.state).toBe('stopped');
    expect(pm.runtimeFor('codex').state).toBe('stopped');
  });

  it('stop on an unknown agent is a no-op', () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager();
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', proxyManager });
    expect(pm.stop('ghost').state).toBe('stopped');
  });

  it('stopAll stops every running agent', async () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager();
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });
    await pm.start(makePlan('codex'), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await pm.start(makePlan('claude'), headroom, '/hb/headroom', headroom.defaultFlags, 'Claude', 5000);
    pm.stopAll();
    expect(pm.runtimeFor('codex').state).toBe('stopped');
    expect(pm.runtimeFor('claude').state).toBe('stopped');
  });

  it('reports proxy exit through runtime state', async () => {
    let exitCb: ((...a: unknown[]) => void) | undefined;
    const { spawn } = fakeSpawn();
    const wrappedSpawn: SpawnFn = (cmd, args, opts) => {
      const proc = spawn(cmd, args, opts);
      if (cmd === '/hb/headroom') {
        const origOn = proc.on.bind(proc);
        proc.on = (event, cb) => {
          if (event === 'exit') exitCb = cb as (...a: unknown[]) => void;
          origOn(event, cb);
        };
      }
      return proc;
    };
    const proxyManager = new ProxyManager({ spawn: wrappedSpawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });
    const pm = new ProcessManager({ spawn: wrappedSpawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });
    await pm.start(makePlan(), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    exitCb?.(1);
    expect(pm.runtimeFor('codex').state).toBe('stopped');
  });
});
