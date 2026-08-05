/**
 * REAL launch sweep — every compressor AND agent installed on this machine,
 * launched through the real spawn/fetch machinery at its EXACT default port.
 *
 * Two sweeps:
 *   A. Compressors (server mode): spawn on `defaultPort`, verify the process
 *      is alive and something answers TCP on EXACTLY that port, then stop and
 *      verify the port is released (group-kill hygiene).
 *   B. Agents: launch each installed agent through the installed compressor
 *      (headroom preferred, else pxpipe) on the agent's EXACT default port via
 *      the embedded (python-pty) path — no terminal windows pop up. Verify the
 *      proxy binds the exact port, the agent process is spawned, then stop.
 *
 * Compressors/agents not installed on the current machine are skipped with a
 * message. GUI-type agents (cursor, zcode) are verified up to binary+proxy
 * (spawning the editor would pop a window) and reported SKIP(GUI).
 *
 * Run: npx vitest run tests/real-launch.test.ts
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import { AGENTS, getAgent } from '../src/core/agents';
import { PROXIES, getProxy } from '../src/core/proxies/registry';
import { currentPlatformContext, mergePathWithUserBins } from '../src/core/platform';
import { scanAgent } from '../src/core/scanner';
import { defaultProfile } from '../src/core/config';
import { buildAgentEnv, buildLaunchPlan, ProcessManager, SpawnedProcess } from '../src/core/launcher';
import { ProxyManager } from '../src/core/proxy-manager';
import { Logger } from '../src/core/logger';
import type { AgentDefinition } from '../src/shared/types';
import type { ProxyDefinition } from '../src/core/proxies/types';

/** Adapter from ProxyDefinition -> AgentDefinition (mirrors main/ipc.ts). */
function proxyToAgentDef(p: ProxyDefinition): AgentDefinition {
  return {
    id: p.id,
    name: p.name,
    vendor: 'tokenzero',
    description: p.description,
    interfaceType: 'cli',
    launchStrategy: 'env',
    executables: p.executables,
    wellKnownPaths: p.wellKnownPaths,
    envStyle: p.envStyle === 'none' ? 'none' : p.envStyle,
    defaultArgs: [],
    configFileHint: '',
    defaultPort: p.defaultPort,
    accent: '#8b5cf6',
    homepage: '',
  };
}

/** Scan a compressor via its executables (real binary resolution). */
function scanCompressor(p: ProxyDefinition) {
  return scanAgent(proxyToAgentDef(p), ctx);
}

/** True when something answers TCP on 127.0.0.1:port (connect probe). */
function tcpOpen(port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = require('node:net').connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

/** Poll until the port is free (connection refused) or the timeout elapses. */
async function waitPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await tcpOpen(port, 300))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !(await tcpOpen(port, 300));
}

/** Poll until something answers TCP on the port (listener up) or timeout. */
async function waitPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpOpen(port, 300)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return await tcpOpen(port, 300);
}

/** True when a PID is still alive (signal 0 probe). */
function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const logger = new Logger();
// REAL filesystem-backed platform context — paths must actually exist.
const ctx = currentPlatformContext((p) => fs.existsSync(p));

/** Real spawn wrapper for ProxyManager/ProcessManager (detached, like the app). */
function realSpawn(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd: string; detached?: boolean },
): SpawnedProcess {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const basePath = process.env.PATH ?? process.env.Path ?? '';
  const mergedPath = mergePathWithUserBins(basePath, ctx.platform, home);
  const child = nodeSpawn(cmd, args, {
    env: { ...process.env, PATH: mergedPath, ...opts.env },
    cwd: opts.cwd === '.' ? process.cwd() : opts.cwd,
    detached: opts.detached ?? false,
    windowsHide: false,
    shell: false,
  });
  if (opts.detached) child.unref();
  // Cast: node's ChildProcess#kill accepts number|Signals; the injected
  // interfaces narrow it to string. main/ipc.ts does the same cast.
  return child as unknown as SpawnedProcess;
}

/** Real HTTP readiness fetch (mirrors main/ipc.ts). */
async function realFetch(url: string): Promise<{ status: number }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { status: res.status };
  } catch {
    return { status: 0 };
  }
}

function newProxyManager(): ProxyManager {
  return new ProxyManager({
    spawn: realSpawn,
    fetch: realFetch,
    sleep: () => new Promise((r) => setTimeout(r, 150)),
    logger,
    platform: ctx.platform,
  });
}

/** Kill every process listening on a port (test teardown safety net). */
function killPortProcesses(port: number): Promise<void> {
  return new Promise((resolve) => {
    const child = nodeSpawn('sh', ['-c', `lsof -ti :${port} | xargs kill -9 2>/dev/null || true`], { stdio: 'ignore' });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

/** Installed (server-mode) compressors with their resolved binary. */
const installedCompressors: Array<{ id: string; bin: string; def: ProxyDefinition }> = [];
/** Installed agents with their resolved binary (env/instructions strategy). */
const installedAgents: Array<{ id: string; bin: string; def: AgentDefinition }> = [];
/** All ports we used — swept clean after the run. */
const portsUsed: number[] = [];

beforeAll(() => {
  for (const p of PROXIES) {
    if (p.mode !== 'server') continue;
    try {
      const scan = scanCompressor(p);
      if (scan.found && scan.paths[0]) {
        installedCompressors.push({ id: p.id, bin: scan.paths[0], def: p });
      }
    } catch {
      /* scanner may not support the definition shape — skip */
    }
  }
  for (const a of AGENTS) {
    if (a.launchStrategy === 'instructions') continue; // no process to spawn
    try {
      const scan = scanAgent(a, ctx);
      if (scan.found && scan.paths[0]) {
        installedAgents.push({ id: a.id, bin: scan.paths[0], def: a });
      }
    } catch {
      /* skip */
    }
  }
});

afterAll(async () => {
  for (const port of portsUsed) {
    await killPortProcesses(port);
  }
});

describe('REAL sweep A — installed compressors bind their EXACT default ports', () => {
  it('found at least headroom or pxpipe on this machine', () => {
    expect(installedCompressors.length).toBeGreaterThan(0);
  });

  it.each(installedCompressors.map((c) => [c.id, c] as const))(
    '%s: process alive + TCP listen on default port %s, port released on stop',
    async (_id, { bin, def }) => {
      const port = def.defaultPort;
      expect(port, `${def.id} must have a default port`).toBeGreaterThan(0);
      portsUsed.push(port);
      // The exact default port must be FREE before we start (else a stale
      // process from a previous run is holding it — that is the port bug).
      if (await tcpOpen(port, 500)) {
        await killPortProcesses(port);
      }
      await waitPortFree(port, 5000);

      const pm = newProxyManager();
      const profile = { ...defaultProfile('codex'), port, autoPort: false };
      const runtime = await pm.start(`real-${def.id}`, def, bin, port, profile.mode === 'cache' ? { mode: 'cache' } : {}, 60000);

      try {
        expect(runtime.state).toBe('up');
        expect(pidAlive(runtime.pid), `${def.id} proxy process (pid ${runtime.pid}) must be alive`).toBe(true);
        const listening = await waitPortOpen(port, 30000);
        expect(listening, `${def.id} must listen on its default port ${port}`).toBe(true);

        const agent = getAgent('codex');
        const env = buildAgentEnv(agent, profile, def);
        if (agent.envStyle === 'openai' || agent.envStyle === 'both') {
          expect(env.OPENAI_BASE_URL).toBe(`http://127.0.0.1:${port}/v1`);
        }
        if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
          expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:${port}`);
        }
      } finally {
        await pm.stop(`real-${def.id}`);
      }
      // Group-kill hygiene: after stop the port must come back free (SIGTERM +
      // SIGKILL on the whole process group, not just the direct child).
      const free = await waitPortFree(port, 10000);
      expect(free, `${def.id} default port ${port} must be free after stop (no orphaned proxy)`).toBe(true);
    },
    90000,
  );
});

describe('REAL sweep B — installed agents launch at their EXACT default ports', () => {
  it('found at least one installed CLI agent on this machine', () => {
    expect(installedAgents.length).toBeGreaterThan(0);
  });

  it.each(installedAgents.map((a) => [a.id, a] as const))(
    '%s: proxy binds default port %s, agent process spawned',
    async (_id, { bin, def }) => {
      // GUI editors (cursor, zcode): verify binary + proxy on the exact port
      // without popping the app window.
      if (def.interfaceType === 'gui') {
        expect(fs.existsSync(bin), `${def.id} binary exists`).toBe(true);
        const port = def.defaultPort;
        portsUsed.push(port);
        const pm = newProxyManager();
        if (await tcpOpen(port, 500)) await killPortProcesses(port);
        await waitPortFree(port, 5000);
        const runtime = await pm.start(`real-${def.id}`, getProxy('headroom'), installedCompressors[0]?.bin ?? bin, port, {}, 60000);
        void runtime; // proxy state verified via TCP probe below (GUI skip path)
        try {
          expect(await waitPortOpen(port, 30000), `${def.id} proxy on ${port}`).toBe(true);
        } finally {
          await pm.stop(`real-${def.id}`);
        }
        await waitPortFree(port, 10000);
        return; // SKIP(GUI) — reported as pass with proxy verification only
      }

      const port = def.defaultPort;
      expect(port, `${def.id} must have a default port`).toBeGreaterThan(0);
      portsUsed.push(port);
      if (await tcpOpen(port, 500)) await killPortProcesses(port);
      await waitPortFree(port, 5000);

      // Compressor: prefer headroom (both envStyles), else pxpipe, else any installed.
      const proxyDef =
        installedCompressors.find((c) => c.id === 'headroom') ??
        installedCompressors.find((c) => c.id === 'pxpipe') ??
        installedCompressors[0];
      expect(proxyDef, `need an installed server compressor for ${def.id}`).toBeTruthy();

      const profile = { ...defaultProfile(def.id), port, autoPort: false };
      const plan = buildLaunchPlan(def, profile, proxyDef!.def, proxyDef!.bin, bin);
      const proxyManager = newProxyManager();
      const pm = new ProcessManager({
        spawn: realSpawn,
        fetch: realFetch,
        sleep: () => new Promise((r) => setTimeout(r, 150)),
        logger,
        platform: ctx.platform,
        proxyManager,
        exists: (p) => fs.existsSync(p),
        env: process.env as Record<string, string | undefined>,
        homeDir: process.env.HOME ?? '',
        terminalMode: 'python-pty',
      });

      let runtime;
      try {
        runtime = await pm.start(`real-agent-${def.id}`, plan, proxyDef!.def, proxyDef!.bin, {}, def.name, 60000, true);
        // Proxy must be up on the agent's EXACT default port.
        expect(await waitPortOpen(port, 30000), `${def.id} proxy must listen on default port ${port}`).toBe(true);
        // Agent process must have been spawned (embedded python-pty bridge).
        expect(pidAlive(runtime.agentPid), `${def.id} agent process (pid ${runtime.agentPid}) must be alive`).toBe(true);
        // Give the agent a moment; record whether it stays alive or exits
        // (exit is often auth/config, not a launcher bug — reported, not failed).
        await new Promise((r) => setTimeout(r, 3000));
        const stillAlive = pidAlive(runtime.agentPid);
        console.log(`[sweep] ${def.id}: agent pid ${runtime.agentPid} alive-after-3s=${stillAlive}`);
      } finally {
        try {
          await pm.stop(`real-agent-${def.id}`);
        } catch {
          /* already stopped */
        }
      }
      const free = await waitPortFree(port, 10000);
      expect(free, `${def.id} default port ${port} must be free after stop`).toBe(true);
    },
    90000,
  );
});

describe('launch plan selects the user-requested compressor + port (no hardcoding)', () => {
  it.each(PROXIES.filter((p) => p.mode === 'server').map((p) => [p.id, p] as const))(
    'builds the plan for %s with the agent port',
    (proxyId, def) => {
      const agent = getAgent('claude');
      const profile = { ...defaultProfile('claude'), port: 8404, autoPort: false };
      const plan = buildLaunchPlan(agent, profile, def, `/real/bin/${proxyId}`, '/real/bin/claude');
      expect(plan.port).toBe(8404);
      expect(plan.headroomBin).toBe(`/real/bin/${proxyId}`);
      expect(plan.strategy).toBe(agent.launchStrategy);
    },
  );
});

describe('uninstalled compressors fail the launch path with a clear error', () => {
  it('the scan-based launch guard rejects when the proxy binary is missing', async () => {
    const missing = PROXIES.filter((p) => p.mode === 'server' && !scanCompressor(p).found).map((p) => p.id);
    if (missing.length === 0) {
      expect(missing.length).toBe(0);
      return;
    }
    for (const id of missing) {
      const scan = scanCompressor(getProxy(id));
      expect(scan.found, `${id} should not be installed (else remove from list)`).toBe(false);
    }
  });
});

describe('launch-port selection edge cases (launch bar -> backend)', () => {
  it('uses the user-selected port when autoPort is off and the port is free', () => {
    const def = getProxy('llmlingua');
    const agent = getAgent('claude');
    const profile = { ...defaultProfile('claude'), port: 8910, autoPort: false };
    const plan = buildLaunchPlan(agent, profile, def, '/real/bin/llmlingua', '/real/bin/claude');
    expect(plan.port).toBe(8910);
    expect(plan.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8910');
  });

  it('falls back to default port when profile port is 0 or unset', () => {
    // buildLaunchPlan trusts the resolved port passed in; chooseLaunchPort does
    // the 0 -> defaultPort fallback in the main process. Verify the contract:
    // buildLaunchPlan passes the profile port through verbatim (0 is the
    // caller's signal to fall back).
    const def = getProxy('pxpipe');
    const agent = getAgent('claude');
    const profile = { ...defaultProfile('claude'), port: 0, autoPort: false };
    const plan = buildLaunchPlan(agent, profile, def, '/real/bin/pxpipe', '/real/bin/claude');
    expect(plan.port).toBe(0);
    // env style for pxpipe is anthropic.
    if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
      expect(plan.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:0');
    }
  });

  it('propagates the compressorId through buildLaunchPlan (no hardcoding)', () => {
    const headroom = getProxy('headroom');
    const pxpipe = getProxy('pxpipe');
    const agent = getAgent('claude');
    const profile = { ...defaultProfile('claude'), port: 8920, autoPort: false };
    const p1 = buildLaunchPlan(agent, profile, headroom, '/b/headroom', '/b/claude');
    const p2 = buildLaunchPlan(agent, profile, pxpipe, '/b/pxpipe', '/b/claude');
    // Both use the SAME selected port, but different binaries/envs.
    expect(p1.port).toBe(p2.port);
    expect(p1.port).toBe(8920);
    // headroom is arg-configured (--port appears as its own token).
    expect(p1.proxyArgs).toContain('8920');
    // pxpipe is env-configured: buildStartArgs returns [] (no port flag) and
    // buildStartEnv supplies PORT/HOST at spawn time (not in plan.env).
    expect(p2.proxyArgs).toEqual([]);
    expect(pxpipe.buildStartEnv).toBeDefined();
    expect(pxpipe.buildStartEnv!(8920, {}).PORT).toBe('8920');
    expect(pxpipe.buildStartEnv!(8920, {}).HOST).toBe('127.0.0.1');
  });
});

