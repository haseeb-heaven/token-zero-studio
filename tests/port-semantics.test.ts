/**
 * Port semantics per compressor mode — answers "which port does this launch
 * actually use, and does the compressor listen on it?"
 *
 * - Server compressors (headroom, pxpipe, …) bind the agent's resolved port.
 * - Wrapper compressors (rtk, caveman, ponytail) open NO port at all — the
 *   agent launches without a proxy listener (this is why lsof finds nothing).
 */
import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/core/agents';
import { defaultProfile } from '../src/core/config';
import { buildLaunchPlan, buildProxyArgs } from '../src/core/launcher';
import { PROXIES, getProxy } from '../src/core/proxies/registry';

describe('compressor port semantics', () => {
  it('server compressors expose a default port', () => {
    for (const p of PROXIES) {
      if (p.mode === 'server') {
        expect(p.defaultPort, `${p.id} server port`).toBeGreaterThan(0);
      }
    }
  });

  it('wrapper compressors (rtk/caveman/ponytail) have no port and no start args', () => {
    for (const id of ['rtk', 'caveman', 'ponytail']) {
      const def = getProxy(id);
      expect(def.mode).toBe('wrapper');
      expect(def.defaultPort).toBe(0);
      expect(def.buildStartArgs(9999, {})).toEqual([]);
      expect(def.buildStartEnv?.(9999, {}) ?? {}).toEqual({});
    }
  });

  it('launch plan port = agent default port for every agent × compressor pair', () => {
    for (const agent of AGENTS) {
      const profile = { ...defaultProfile(agent.id), port: agent.defaultPort };
      for (const proxy of PROXIES) {
        const agentBin = agent.launchStrategy === 'env' ? `/fake/bin/${agent.id}` : null;
        const plan = buildLaunchPlan(agent, profile, proxy, `/fake/proxy/${proxy.id}`, agentBin);
        expect(plan.port, `${agent.id} × ${proxy.id}`).toBe(agent.defaultPort);
        expect(plan.agentId, `${agent.id} × ${proxy.id}`).toBe(agent.id);
        expect(plan.headroomBin, `${agent.id} × ${proxy.id}`).toBe(`/fake/proxy/${proxy.id}`);
      }
    }
  });

  it('headroom proxy args bind exactly the agent port', () => {
    const headroom = getProxy('headroom');
    const profile = { ...defaultProfile('codex'), port: 8989 };
    const args = buildProxyArgs(headroom, profile);
    expect(args).toContain('--port');
    expect(args[args.indexOf('--port') + 1]).toBe('8989');
  });

  it('pxpipe env binds exactly the agent port via PORT', () => {
    const pxpipe = getProxy('pxpipe');
    const profile = { ...defaultProfile('codex'), port: 8989 };
    expect(buildProxyArgs(pxpipe, profile)).toEqual([]);
    expect(pxpipe.buildStartEnv?.(profile.port, {})).toEqual({ PORT: '8989', HOST: '127.0.0.1' });
  });
});
