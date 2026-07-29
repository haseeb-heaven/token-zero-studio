import { describe, expect, it } from 'vitest';
import { AGENTS, getAgent, hasAgent } from '../src/core/agents';

describe('agent registry', () => {
  it('covers every tool supported by headroom wrap (v0.32.x)', () => {
    const expected = [
      'aider',
      'claude',
      'cline',
      'codex',
      'continue',
      'copilot',
      'cursor',
      'goose',
      'grok',
      'grok-build',
      'kimi',
      'omp',
      'openclaude',
      'openclaw',
      'opencode',
      'openhands',
      'vibe',
      'zcode',
    ];
    expect(AGENTS.map((a) => a.id).sort()).toEqual(expected.sort());
    expect(AGENTS.length).toBe(18);
  });

  it('has unique ids and unique default ports', () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ports = AGENTS.map((a) => a.defaultPort);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('every agent has complete, valid metadata', () => {
    for (const agent of AGENTS) {
      expect(agent.name.trim().length, agent.id).toBeGreaterThan(0);
      expect(agent.vendor.trim().length, agent.id).toBeGreaterThan(0);
      expect(agent.description.trim().length, agent.id).toBeGreaterThan(0);
      expect(['cli', 'gui', 'ide-extension'], agent.id).toContain(agent.interfaceType);
      expect(['env', 'instructions'], agent.id).toContain(agent.launchStrategy);
      expect(['anthropic', 'openai', 'both', 'none'], agent.id).toContain(agent.envStyle);
      expect(agent.defaultPort, agent.id).toBeGreaterThanOrEqual(1024);
      expect(agent.defaultPort, agent.id).toBeLessThanOrEqual(65535);
      expect(agent.accent, agent.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(agent.homepage, agent.id).toMatch(/^https?:\/\//);
      expect(Array.isArray(agent.defaultArgs), agent.id).toBe(true);
      // env-strategy agents must have at least one executable to launch
      if (agent.launchStrategy === 'env') {
        expect(agent.executables.length, agent.id).toBeGreaterThan(0);
      }
    }
  });

  it('well-known paths only reference valid platforms', () => {
    for (const agent of AGENTS) {
      for (const key of Object.keys(agent.wellKnownPaths)) {
        expect(['win32', 'darwin', 'linux']).toContain(key);
        expect(agent.wellKnownPaths[key as 'win32']!.length).toBeGreaterThan(0);
      }
    }
  });

  it('getAgent returns definitions and throws for unknown ids', () => {
    expect(getAgent('codex').name).toBe('OpenAI Codex CLI');
    expect(() => getAgent('nope')).toThrow(/Unknown agent id/);
  });

  it('hasAgent guards lookups', () => {
    expect(hasAgent('claude')).toBe(true);
    expect(hasAgent('gpt-5')).toBe(false);
  });

  it('matches the Dev_HeadRoom_Commnands scripts: claude/codex/cline/grok ports and env styles', () => {
    expect(getAgent('codex').defaultPort).toBe(8787); // run_codex.cmd uses 8787
    expect(getAgent('claude').defaultPort).toBe(8798); // run_claude.cmd uses 8798
    expect(getAgent('codex').envStyle).toBe('openai'); // OPENAI_BASE_URL only
    expect(getAgent('claude').envStyle).toBe('anthropic'); // ANTHROPIC_BASE_URL only
    expect(getAgent('grok').envStyle).toBe('both'); // run_grok sets both
    expect(getAgent('cline').envStyle).toBe('both'); // run_cline sets both
  });
});
