/**
 * Compatibility model between compressors and agents (src/core/compatibility.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY,
  compatibleAgentIds,
  compatibleCompressorIds,
  detectionStatus,
  isCompatible,
} from '../src/core/compatibility';
import { AGENTS, getAgent } from '../src/core/agents';
import { PROXIES, getProxy } from '../src/core/proxies/registry';
import type { AgentDefinition, ScanResult } from '../src/shared/types';

function fakeAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    vendor: 'test',
    description: '',
    interfaceType: 'cli',
    launchStrategy: 'env',
    executables: ['test-agent'],
    wellKnownPaths: {},
    envStyle: 'both',
    defaultArgs: [],
    configFileHint: '',
    defaultPort: 8700,
    accent: '',
    homepage: '',
    ...overrides,
  };
}

describe('COMPATIBILITY table', () => {
  it('declares wrapper compressors (rtk/caveman/ponytail) compatible with all agents', () => {
    for (const id of ['rtk', 'caveman', 'ponytail']) {
      const rule = COMPATIBILITY.find((r) => r.compressorId === id);
      expect(rule).toBeDefined();
      expect(rule!.agentIds).toContain('*');
    }
  });

  it('every compressor id in the table exists in the registry', () => {
    const ids = PROXIES.map((p) => p.id);
    for (const rule of COMPATIBILITY) {
      expect(ids, `compressor ${rule.compressorId}`).toContain(rule.compressorId);
    }
  });
});

describe('isCompatible', () => {
  it('wrapper compressors cannot drive GUI agents even with an explicit rule', () => {
    const gui = fakeAgent({ interfaceType: 'gui' });
    expect(isCompatible({ id: 'rtk', mode: 'wrapper', envStyle: 'none' }, gui)).toBe(false);
  });

  it('explicit rule matches all agents with *', () => {
    const cli = fakeAgent({ interfaceType: 'cli' });
    expect(isCompatible({ id: 'rtk', mode: 'wrapper', envStyle: 'none' }, cli)).toBe(true);
  });

  it('wrapper compressors without a rule reject GUI agents but accept CLI', () => {
    const gui = fakeAgent({ interfaceType: 'gui' });
    const cli = fakeAgent({ interfaceType: 'cli' });
    const def = { id: 'some-wrapper', mode: 'wrapper' as const, envStyle: 'none' as const };
    expect(isCompatible(def, gui)).toBe(false);
    expect(isCompatible(def, cli)).toBe(true);
  });

  it('server compressors that inject no env vars reject everyone', () => {
    const def = { id: 'no-inject', mode: 'server' as const, envStyle: 'none' as const };
    expect(isCompatible(def, fakeAgent({ envStyle: 'both' }))).toBe(false);
  });

  it('server compressors require the agent to read at least one base URL', () => {
    const server = { id: 'svc', mode: 'server' as const, envStyle: 'both' as const };
    expect(isCompatible(server, fakeAgent({ envStyle: 'openai' }))).toBe(true);
    expect(isCompatible(server, fakeAgent({ envStyle: 'anthropic' }))).toBe(true);
    expect(isCompatible(server, fakeAgent({ envStyle: 'none' }))).toBe(false);
  });

  it('headroom (server, both) is compatible with CLI agents that read env', () => {
    const headroom = getProxy('headroom');
    const codex = getAgent('codex'); // envStyle openai
    expect(isCompatible(headroom, codex)).toBe(true);
  });
});

describe('compatibleAgentIds / compatibleCompressorIds', () => {
  it('returns all non-GUI agent ids for wildcard wrapper compressors', () => {
    const rtk = getProxy('rtk');
    const ids = compatibleAgentIds('rtk', rtk, AGENTS);
    const guiCount = AGENTS.filter((a) => a.interfaceType === 'gui').length;
    expect(ids.length).toBe(AGENTS.length - guiCount);
    // GUI agents (cursor, windsurf, zcode) cannot be driven by a shell wrapper.
    for (const gui of AGENTS.filter((a) => a.interfaceType === 'gui')) {
      expect(ids).not.toContain(gui.id);
    }
  });

  it('returns only env-reading agents for server compressors', () => {
    const headroom = getProxy('headroom');
    const ids = compatibleAgentIds('headroom', headroom, AGENTS);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('codex');
    expect(ids).toContain('claude');
  });

  it('works without a definition (falls back to id-only)', () => {
    const ids = compatibleAgentIds('ghost', undefined, AGENTS);
    expect(Array.isArray(ids)).toBe(true);
  });

  it('filters compressor list per agent', () => {
    const codex = getAgent('codex');
    const compressors = PROXIES.map((p) => ({ id: p.id, mode: p.mode, envStyle: p.envStyle }));
    const ids = compatibleCompressorIds(codex, compressors);
    expect(ids).toContain('headroom');
    expect(ids).toContain('rtk'); // wildcard wrapper
  });
});

describe('detectionStatus', () => {
  const scan = (found: boolean): ScanResult => ({
    agentId: 'x',
    found,
    paths: found ? ['/usr/bin/x'] : [],
    source: found ? 'path' : 'none',
  });

  it('classifies installed / not-found / manual / invalid-path', () => {
    expect(detectionStatus(scan(true))).toBe('installed');
    expect(detectionStatus(scan(false))).toBe('not-found');
    expect(detectionStatus(scan(true), '/custom/x')).toBe('manually-configured');
    expect(detectionStatus(scan(false), '/custom/x')).toBe('invalid-path');
  });

  it('treats whitespace-only explicit paths as unset', () => {
    expect(detectionStatus(scan(false), '   ')).toBe('not-found');
    expect(detectionStatus(undefined)).toBe('not-found');
  });
});
