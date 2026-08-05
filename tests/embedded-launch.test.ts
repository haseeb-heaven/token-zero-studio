/**
 * Embedded Workflow CLI launch — PTY command building, stdin, exit handling.
 */
import { describe, expect, it } from 'vitest';
import {
  ProcessManager,
  SpawnFn,
  SpawnedProcess,
  buildEmbeddedLaunchCommand,
  buildLaunchPlan,
  formatStdinPayload,
  resolvePythonBinary,
} from '../src/core/launcher';
import { getAgent } from '../src/core/agents';
import { defaultProfile } from '../src/core/config';
import { getProxy } from '../src/core/proxies/registry';
import { ProxyManager } from '../src/core/proxy-manager';
import { Logger } from '../src/core/logger';

function fakeSpawn(): {
  spawn: SpawnFn;
  spawned: { cmd: string; args: string[]; opts: { env: Record<string, string>; cwd: string }; proc: SpawnedProcess }[];
} {
  const spawned: { cmd: string; args: string[]; opts: { env: Record<string, string>; cwd: string }; proc: SpawnedProcess }[] = [];
  const spawn: SpawnFn = (cmd, args, opts) => {
    const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
    let stdinData = '';
    const proc: SpawnedProcess = {
      pid: 3000 + spawned.length,
      stdin: {
        write: (chunk: string) => {
          stdinData += chunk;
          return true;
        },
      } as unknown as NodeJS.WritableStream,
      stdout: null,
      stderr: null,
      on: (event, cb) => {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      },
      kill: () => {
        for (const cb of listeners.get('exit') ?? []) cb(0);
      },
      // test helper
      _emitExit(code: number) {
        for (const cb of listeners.get('exit') ?? []) cb(code);
      },
      _stdinData: () => stdinData,
    } as SpawnedProcess & { _emitExit: (c: number) => void; _stdinData: () => string };
    spawned.push({ cmd, args: [...args], opts, proc });
    return proc;
  };
  return { spawn, spawned };
}

const readyFetch = async () => ({ status: 200 });
const noSleep = () => Promise.resolve();

describe('resolvePythonBinary', () => {
  it('prefers an absolute path that exists over bare python3', () => {
    const resolved = resolvePythonBinary('darwin', (p) => p === '/opt/homebrew/bin/python3', {
      PATH: '/opt/homebrew/bin:/usr/bin',
    });
    expect(resolved).toBe('/opt/homebrew/bin/python3');
  });

  it('falls back to python3 when nothing exists', () => {
    expect(resolvePythonBinary('linux', () => false, {})).toBe('python3');
  });

  it('on win32 prefers py launcher then python', () => {
    const resolved = resolvePythonBinary('win32', (p) => p.toLowerCase().endsWith('python.exe'), {
      PATH: 'C:\\Python312;C:\\Windows',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    });
    expect(resolved.toLowerCase()).toContain('python');
  });
});

describe('buildEmbeddedLaunchCommand', () => {
  it('on darwin uses absolute python with PTY script for CLI agents', () => {
    const cmd = buildEmbeddedLaunchCommand({
      platform: 'darwin',
      strategy: 'env',
      agentBin: '/opt/homebrew/bin/codex',
      agentArgs: [],
      exists: (p) => p === '/opt/homebrew/bin/python3',
      env: { PATH: '/opt/homebrew/bin' },
    });
    expect(cmd.method).toBe('python-pty');
    expect(cmd.cmd).toBe('/opt/homebrew/bin/python3');
    expect(cmd.args[0]).toBe('-u');
    expect(cmd.args[1]).toBe('-c');
    expect(cmd.args[2]).toContain('pty.fork');
    expect(cmd.args[2]).toContain('/opt/homebrew/bin/codex');
    expect(cmd.args[2]).toContain('os.execv');
  });

  it('escapes single quotes in binary paths inside the python script', () => {
    const cmd = buildEmbeddedLaunchCommand({
      platform: 'linux',
      strategy: 'env',
      agentBin: "/opt/homebrew/bin/o'codex",
      agentArgs: ["--foo"],
      exists: () => false,
      env: {},
    });
    expect(cmd.args[2]).toContain("o\\'codex");
  });

  it('falls back to direct spawn for non-env strategy', () => {
    const cmd = buildEmbeddedLaunchCommand({
      platform: 'darwin',
      strategy: 'instructions',
      agentBin: '/usr/bin/true',
      agentArgs: [],
      exists: () => true,
      env: {},
    });
    expect(cmd.method).toBe('direct');
    expect(cmd.cmd).toBe('/usr/bin/true');
  });

  it('on win32 uses direct spawn for CLI agents', () => {
    const cmd = buildEmbeddedLaunchCommand({
      platform: 'win32',
      strategy: 'env',
      agentBin: 'C:\\npm\\codex.cmd',
      agentArgs: ['--resume'],
      exists: () => false,
      env: {},
    });
    expect(cmd.method).toBe('direct');
    expect(cmd.cmd).toBe('C:\\npm\\codex.cmd');
    expect(cmd.args).toEqual(['--resume']);
  });
});

describe('formatStdinPayload', () => {
  it('appends newline for normal commands', () => {
    expect(formatStdinPayload('hello')).toBe('hello\n');
  });

  it('does not append newline for Ctrl+C / Ctrl+D control chars', () => {
    expect(formatStdinPayload('\u0003')).toBe('\u0003');
    expect(formatStdinPayload('\u0004')).toBe('\u0004');
  });

  it('does not double-append when text already ends with newline', () => {
    expect(formatStdinPayload('hi\n')).toBe('hi\n');
  });
});

describe('ProcessManager embedded launch', () => {
  it('spawns via python-pty for embedded CLI on linux and wires stdin', async () => {
    const { spawn, spawned } = fakeSpawn();
    const proxyManager = new ProxyManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux',
    });
    const pm = new ProcessManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(),
      platform: 'linux', terminal: 'xterm', proxyManager,
      exists: (p) => p === '/usr/bin/python3',
      env: { PATH: '/usr/bin' },
    });
    const agent = getAgent('codex');
    const profile = { ...defaultProfile('codex'), port: 8401 };
    const headroom = getProxy('headroom');
    const plan = buildLaunchPlan(agent, profile, headroom, '/hb/headroom', '/usr/bin/codex');

    const rt = await pm.start('codex-1', plan, headroom, '/hb/headroom', headroom.defaultFlags, 'OpenAI Codex CLI', 1000, true);
    expect(rt.state).toBe('running');

    // First spawn is proxy, second is embedded agent
    const agentSpawn = spawned[spawned.length - 1];
    expect(agentSpawn.cmd).toBe('/usr/bin/python3');
    expect(agentSpawn.args[2]).toContain('/usr/bin/codex');
    expect(agentSpawn.opts.env.TERM).toBe('xterm-256color');

    expect(pm.writeStdin('codex-1', 'hello')).toBe(true);
    const proc = agentSpawn.proc as SpawnedProcess & { _stdinData: () => string };
    expect(proc._stdinData()).toBe('hello\n');

    pm.stop('codex-1');
  });

  it('marks runtime stopped (not proxy-up) when embedded agent exits', async () => {
    const { spawn, spawned } = fakeSpawn();
    const proxyManager = new ProxyManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux',
    });
    const pm = new ProcessManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(),
      platform: 'linux', terminal: 'xterm', proxyManager,
      exists: () => false,
      env: {},
    });
    const agent = getAgent('codex');
    const profile = { ...defaultProfile('codex'), port: 8402 };
    const headroom = getProxy('headroom');
    const plan = buildLaunchPlan(agent, profile, headroom, '/hb/headroom', '/usr/bin/codex');

    await pm.start('codex-2', plan, headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 1000, true);
    const agentSpawn = spawned[spawned.length - 1];
    const proc = agentSpawn.proc as SpawnedProcess & { _emitExit: (c: number) => void };
    proc._emitExit(1);
    expect(pm.runtimeFor('codex-2').state).toBe('stopped');
    pm.stop('codex-2');
  });

  it('pipes logs with launchId as source so output routes to the correct tab', async () => {
    const logs: { source: string; message: string }[] = [];
    const logger = new Logger();
    logger.subscribe((e) => logs.push({ source: e.source, message: e.message }));

    const { spawn } = fakeSpawn();
    const proxyManager = new ProxyManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger, platform: 'darwin',
    });
    const pm = new ProcessManager({
      spawn, fetch: readyFetch, sleep: noSleep, logger,
      platform: 'darwin', terminal: 'xterm', proxyManager,
      exists: (p) => p.includes('python'),
      env: { PATH: '/opt/homebrew/bin' },
    });
    const agent = getAgent('codex');
    const profile = { ...defaultProfile('codex'), port: 8403 };
    const headroom = getProxy('headroom');
    const plan = buildLaunchPlan(agent, profile, headroom, '/hb/headroom', '/opt/homebrew/bin/codex');

    await pm.start('codex-3', plan, headroom, '/hb/headroom', headroom.defaultFlags, 'OpenAI Codex CLI', 1000, true);
    // Spawning log should use launchId so IPC can map 1:1
    expect(logs.some((l) => l.source === 'codex-3' && /Spawning|PTY launch/i.test(l.message))).toBe(true);
    pm.stop('codex-3');
  });
});
