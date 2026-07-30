import { describe, expect, it } from 'vitest';
import { ProxyManager, waitForProxyReady } from '../src/core/proxy-manager';
import { getProxy } from '../src/core/proxies/registry';
import { Logger } from '../src/core/logger';
import type { ProxyFetchFn, ProxySpawnFn, ProxySpawnedProcess } from '../src/core/proxy-manager';

function fakeSpawn(behavior?: {
  onSpawn?: (cmd: string, args: string[]) => void;
}): { spawn: ProxySpawnFn; spawned: { cmd: string; args: string[]; proc: ProxySpawnedProcess }[] } {
  const spawned: { cmd: string; args: string[]; proc: ProxySpawnedProcess }[] = [];
  const spawn: ProxySpawnFn = (cmd, args) => {
    const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
    const proc: ProxySpawnedProcess = {
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

const readyFetch: ProxyFetchFn = async () => ({ status: 200 });
const failFetch: ProxyFetchFn = async () => {
  throw new Error('ECONNREFUSED');
};
const noSleep = () => Promise.resolve();

describe('waitForProxyReady', () => {
  it('resolves true as soon as any endpoint answers', async () => {
    let calls = 0;
    const fetch: ProxyFetchFn = async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return { status: 200 };
    };
    expect(await waitForProxyReady(8989, 5000, fetch, noSleep)).toBe(true);
  });

  it('any HTTP status counts as ready (404 on /livez is fine)', async () => {
    const fetch: ProxyFetchFn = async () => ({ status: 404 });
    expect(await waitForProxyReady(8989, 1000, fetch, noSleep)).toBe(true);
  });

  it('times out when nothing answers', async () => {
    const fetch: ProxyFetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await waitForProxyReady(8989, 300, fetch, noSleep, 50)).toBe(false);
  });
});

describe('ProxyManager', () => {
  it('starts a server-mode proxy: starting -> up', async () => {
    const { spawn, spawned } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });
    const states: string[] = [];
    pm.onRuntimeChange((_id, r) => states.push(r.state));

    const def = getProxy('headroom');
    const runtime = await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);

    expect(runtime.state).toBe('up');
    expect(runtime.port).toBe(8989);
    expect(runtime.pid).toBe(1000);
    expect(spawned[0].cmd).toBe('/hb/headroom');
    expect(spawned[0].args[0]).toBe('proxy');
    expect(spawned[0].args).toContain('--port');
    expect(spawned[0].args).toContain('8989');
    expect(states).toEqual(['starting', 'up']);
  });

  it('starts a wrapper-mode proxy (RTK) immediately with no spawn', async () => {
    const { spawn, spawned } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('rtk');
    const runtime = await pm.start('codex', def, 'rtk', 0, {}, 5000);

    expect(runtime.state).toBe('up');
    expect(spawned.length).toBe(0); // no process spawned for wrapper mode
  });

  it('manages separate proxies per agentId', async () => {
    const { spawn, spawned } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);
    await pm.start('claude', def, '/hb/headroom', 8798, def.defaultFlags, 5000);

    expect(spawned.length).toBe(2);
    expect(pm.runtimeFor('codex').port).toBe(8989);
    expect(pm.runtimeFor('claude').port).toBe(8798);
    expect(pm.runtimeFor('codex').state).toBe('up');
    expect(pm.runtimeFor('claude').state).toBe('up');
  });

  it('fails when the proxy never becomes ready', async () => {
    const { spawn } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: failFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await expect(pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 300)).rejects.toThrow(/did not become ready/);
    expect(pm.runtimeFor('codex').state).toBe('error');
  });

  it('refuses to start twice while running', async () => {
    const { spawn } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);
    await expect(pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000)).rejects.toThrow(/already/);
  });

  it('stop kills the proxy and reports stopped', async () => {
    const { spawn } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);
    const stopped = pm.stop('codex');
    expect(stopped.state).toBe('stopped');
    expect(pm.runtimeFor('codex').state).toBe('stopped');
  });

  it('stop on an already-stopped proxy is a no-op', () => {
    const { spawn } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });
    expect(pm.stop('ghost').state).toBe('stopped');
  });

  it('stopAll stops every running proxy', async () => {
    const { spawn } = fakeSpawn();
    const pm = new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);
    await pm.start('claude', def, '/hb/headroom', 8798, def.defaultFlags, 5000);
    pm.stopAll();
    expect(pm.runtimeFor('codex').state).toBe('stopped');
    expect(pm.runtimeFor('claude').state).toBe('stopped');
  });

  it('reports proxy exit through runtime state', async () => {
    let exitCb: ((...a: unknown[]) => void) | undefined;
    const { spawn } = fakeSpawn();
    const wrappedSpawn: ProxySpawnFn = (cmd, args, opts) => {
      const proc = spawn(cmd, args, opts);
      const origOn = proc.on.bind(proc);
      proc.on = (event, cb) => {
        if (event === 'exit') exitCb = cb as (...a: unknown[]) => void;
        origOn(event, cb);
      };
      return proc;
    };
    const pm = new ProxyManager({ spawn: wrappedSpawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });

    const def = getProxy('headroom');
    await pm.start('codex', def, '/hb/headroom', 8989, def.defaultFlags, 5000);
    expect(pm.runtimeFor('codex').state).toBe('up');
    exitCb?.(1);
    expect(pm.runtimeFor('codex').state).toBe('stopped');
  });
});
