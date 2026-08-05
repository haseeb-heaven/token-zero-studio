import { describe, expect, it } from 'vitest';
import { getAgent } from '../src/core/agents';
import { defaultProfile } from '../src/core/config';
import { getProxy } from '../src/core/proxies/registry';
import {
  ProcessManager,
  SpawnFn,
  SpawnedProcess,
  buildLaunchPlan,
} from '../src/core/launcher';
import { ProxyManager } from '../src/core/proxy-manager';
import { Logger } from '../src/core/logger';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fakeSpawn(): {
  spawn: SpawnFn;
  spawned: { cmd: string; args: string[]; proc: SpawnedProcess }[];
} {
  const spawned: { cmd: string; args: string[]; proc: SpawnedProcess }[] = [];
  const spawn: SpawnFn = (cmd, args) => {
    const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
    const proc: SpawnedProcess = {
      pid: 2000 + spawned.length,
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
    return proc;
  };
  return { spawn, spawned };
}

const readyFetch = async () => ({ status: 200 });
const noSleep = () => Promise.resolve();

function makePlan(agentId = 'codex', port?: number) {
  const agent = getAgent(agentId);
  const profile = { ...defaultProfile(agentId), port: port ?? agent.defaultPort };
  const headroom = getProxy('headroom');
  return buildLaunchPlan(agent, profile, headroom, '/hb/headroom', agent.launchStrategy === 'env' ? '/usr/bin/' + agentId : null);
}

function makeProxyManager(spawn: SpawnFn) {
  return new ProxyManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux' });
}

describe('ProcessManager (launchId-keyed)', () => {
  it('starts two instances of the same agent with distinct launchIds', async () => {
    const { spawn, spawned } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn);
    const headroom = getProxy('headroom');
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    const a = await pm.start('launch-a', makePlan('codex', 8989), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    const b = await pm.start('launch-b', makePlan('codex', 8990), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);

    expect(a.state).toBe('running');
    expect(b.state).toBe('running');
    expect(a.port).toBe(8989);
    expect(b.port).toBe(8990);
    expect(spawned.length).toBe(4); // 2 proxies + 2 agents
    // Both are tracked independently
    expect(pm.runtimeFor('launch-a').state).toBe('running');
    expect(pm.runtimeFor('launch-b').state).toBe('running');
    pm.stop('launch-a');
    expect(pm.runtimeFor('launch-a').state).toBe('stopped');
    expect(pm.runtimeFor('launch-b').state).toBe('running'); // b unaffected
    pm.stop('launch-b')
  });

  it('start for an already-running launchId throws', async () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn);
    const headroom = getProxy('headroom');
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    await pm.start('launch-a', makePlan('codex'), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await expect(pm.start('launch-a', makePlan('codex'), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000)).rejects.toThrow(/already/);
    pm.stop('launch-a');
  });

  it('runtimes reports all active launchIds', async () => {
    const { spawn } = fakeSpawn();
    const headroom = getProxy('headroom');
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    await pm.start('launch-a', makePlan('codex', 8989), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await pm.start('launch-b', makePlan('claude', 8798), headroom, '/hb/headroom', headroom.defaultFlags, 'Claude', 5000);

    const runtimes = pm.allRuntimes();
    expect(runtimes.length).toBe(2);
    expect(runtimes.map((r) => r.id).sort()).toEqual(['launch-a', 'launch-b']);
    pm.stop('launch-a');
    pm.stop('launch-b');
  });

  it('stopAll stops every launch', async () => {
    const { spawn } = fakeSpawn();
    const headroom = getProxy('headroom');
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    await pm.start('launch-a', makePlan('codex', 8989), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await pm.start('launch-b', makePlan('codex', 8990), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    await pm.start('launch-c', makePlan('claude', 8798), headroom, '/hb/headroom', headroom.defaultFlags, 'Claude', 5000);

    pm.stopAll();
    expect(pm.runtimeFor('launch-a').state).toBe('stopped');
    expect(pm.runtimeFor('launch-b').state).toBe('stopped');
    expect(pm.runtimeFor('launch-c').state).toBe('stopped');
  });

  it('stop on unknown launchId is a no-op', () => {
    const { spawn } = fakeSpawn();
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', proxyManager });
    expect(pm.stop('ghost').state).toBe('stopped');
  });

  it('emits runtime changes with id', async () => {
    const { spawn } = fakeSpawn();
    const headroom = getProxy('headroom');
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    const states: Array<{ id: string; state: string }> = [];
    pm.onRuntimeChange((r) => states.push({ id: r.id ?? r.agentId, state: r.state }));

    await pm.start('my-launch', makePlan('codex'), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    expect(states.some((s) => s.id === 'my-launch' && s.state === 'running')).toBe(true);
    pm.stop('my-launch');
  });
});

describe('ProcessManager (launchId) — stop restarts proxy for subsequent launch of same agent', () => {
  it('stops and restarts same agent on different ports as separate launches', async () => {
    const { spawn, spawned } = fakeSpawn();
    const headroom = getProxy('headroom');
    const proxyManager = makeProxyManager(spawn);
    const pm = new ProcessManager({ spawn, fetch: readyFetch, sleep: noSleep, logger: new Logger(), platform: 'linux', terminal: 'xterm', proxyManager });

    await pm.start('first', makePlan('codex', 8989), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    expect(spawned.length).toBe(2);
    pm.stop('first');
    expect(pm.runtimeFor('first').state).toBe('stopped');

    const spawnedBeforeSecond = spawned.length;
    await pm.start('second', makePlan('codex', 8990), headroom, '/hb/headroom', headroom.defaultFlags, 'Codex', 5000);
    expect(spawned.length).toBe(spawnedBeforeSecond + 2); // fresh proxy + agent
    expect(pm.runtimeFor('second').state).toBe('running');
    pm.stop('second');
  });
});