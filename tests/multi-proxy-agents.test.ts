import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/core/agents';
import { defaultProfile } from '../src/core/config';
import {
  FetchFn,
  ProcessManager,
  SpawnFn,
  SpawnedProcess,
  buildAgentEnv,
  buildLaunchPlan,
  buildProxyArgs,
} from '../src/core/launcher';
import { Logger } from '../src/core/logger';
import { PROXIES } from '../src/core/proxies/registry';
import { ProxyManager } from '../src/core/proxy-manager';
import type { AgentDefinition } from '../src/shared/types';

/**
 * Multi-Proxy Agent Testing Matrix
 * Tests all 18 supported models/agents across all 4 proxy optimizers
 * (Headroom, RTK, PxPipe, Custom).
 *
 * Per user request: Cursor agent and port 8787 are skipped.
 */

const ACTIVE_AGENTS = AGENTS.filter((a) => a.id !== 'cursor');

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

const readyFetch: FetchFn = async () => ({ status: 200 });
const noSleep = () => Promise.resolve();

describe('Multi-Proxy Matrix Testing', () => {
  it('has 17 active agents (cursor skipped per request)', () => {
    expect(ACTIVE_AGENTS.length).toBe(17);
    expect(ACTIVE_AGENTS.some((a) => a.id === 'cursor')).toBe(false);
  });

  describe.each(PROXIES.map((p) => [p.id, p] as const))('Proxy: %s', (_proxyId, proxyDef) => {
    describe.each(ACTIVE_AGENTS.map((a) => [a.id, a] as const))('Agent: %s', (agentId, agent: AgentDefinition) => {
      const profile = {
        ...defaultProfile(agentId),
        port: agent.defaultPort === 8787 ? 8989 : agent.defaultPort,
      };

      it('builds proxy start args', () => {
        const args = buildProxyArgs(proxyDef, profile);
        if (proxyDef.id === 'headroom' || proxyDef.id === 'pxpipe') {
          expect(args).toContain(String(profile.port));
        } else if (proxyDef.id === 'rtk') {
          expect(args).toEqual([]);
        } else {
          expect(Array.isArray(args)).toBe(true);
        }
      });

      it('builds a valid launch plan', () => {
        const agentBin = agent.launchStrategy === 'env' ? `/fake/bin/${agentId}` : null;
        const plan = buildLaunchPlan(agent, profile, proxyDef, `/fake/proxy/${proxyDef.id}`, agentBin);

        expect(plan.agentId).toBe(agentId);
        expect(plan.port).toBe(profile.port);
        expect(plan.headroomBin).toBe(`/fake/proxy/${proxyDef.id}`);
        expect(plan.strategy).toBe(agent.launchStrategy);
        if (agent.launchStrategy === 'env') {
          expect(plan.agentBin).toBe(`/fake/bin/${agentId}`);
        } else {
          expect(plan.agentBin).toBe('');
        }
      });

      it('configures environment variables according to agent envStyle and proxy mode', () => {
        const env = buildAgentEnv(agent, profile, proxyDef);
        const base = `http://127.0.0.1:${profile.port}`;

        if (proxyDef.id === 'rtk') {
          // RTK is wrapper mode — does not use proxy base URLs directly from buildAgentEnv
          // (the agent receives standard env unless overridden)
          expect(env.HEADROOM_MEMORY).toBeUndefined();
        }

        if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
          expect(env.ANTHROPIC_BASE_URL).toBe(base);
        } else {
          expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
        }

        if (agent.envStyle === 'openai' || agent.envStyle === 'both') {
          expect(env.OPENAI_BASE_URL).toBe(`${base}/v1`);
        } else {
          expect(env.OPENAI_BASE_URL).toBeUndefined();
        }
      });

      it('executes full ProcessManager lifecycle (start -> running -> stop)', async () => {
        const { spawn, spawned } = fakeSpawn();
        const logger = new Logger();
        const proxyManager = new ProxyManager({
          spawn,
          fetch: readyFetch,
          sleep: noSleep,
          logger,
          platform: 'linux',
        });
        const pm = new ProcessManager({
          spawn,
          fetch: readyFetch,
          sleep: noSleep,
          logger,
          platform: 'linux',
          terminal: 'xterm',
          proxyManager,
        });

        const agentBin = agent.launchStrategy === 'env' ? `/fake/bin/${agentId}` : null;
        const plan = buildLaunchPlan(agent, profile, proxyDef, `/fake/proxy/${proxyDef.id}`, agentBin);

        const runtime = await pm.start(
          plan,
          proxyDef,
          `/fake/proxy/${proxyDef.id}`,
          proxyDef.defaultFlags,
          agent.name,
          5000,
        );

        if (agent.launchStrategy === 'instructions') {
          expect(runtime.state).toBe('proxy-up');
          if (proxyDef.mode === 'server') {
            expect(spawned.length).toBe(1);
            expect(spawned[0].cmd).toBe(`/fake/proxy/${proxyDef.id}`);
          }
        } else {
          expect(runtime.state).toBe('running');
          if (proxyDef.mode === 'server') {
            expect(spawned.length).toBe(2);
            expect(spawned[0].cmd).toBe(`/fake/proxy/${proxyDef.id}`);
            expect(spawned[1].cmd).toBe('xterm');
          } else {
            // Wrapper mode (RTK) only spawns the agent
            expect(spawned.length).toBe(1);
            expect(spawned[0].cmd).toBe('xterm');
          }
        }

        const stopped = pm.stop(agentId);
        expect(stopped.state).toBe('stopped');
        expect(pm.runtimeFor(agentId).state).toBe('stopped');
      });
    });
  });
});
