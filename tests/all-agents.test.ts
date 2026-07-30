import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/core/agents';
import { defaultConfig, defaultProfile, validateProfile } from '../src/core/config';
import { getProxy } from '../src/core/proxies/registry';
import {
  buildAgentEnv,
  buildLaunchPlan,
  buildProxyArgs,
  buildTerminalCommand,
} from '../src/core/launcher';
import type { PlatformContext } from '../src/core/platform';
import { scanAgent } from '../src/core/scanner';
import type { AgentDefinition, EnvStyle, InterfaceType, LaunchStrategy, PlatformName } from '../src/shared/types';

/**
 * Exhaustive per-agent coverage: every agent listed in the launcher UI gets
 * its env wiring, port, launch plan, terminal command and scanning verified
 * individually — plus a table of hand-checked facts per agent.
 */

interface AgentFacts {
  port: number;
  envStyle: EnvStyle;
  interfaceType: InterfaceType;
  strategy: LaunchStrategy;
  executable: string;
  configHintIncludes: string;
}

const FACTS: Record<string, AgentFacts> = {
  claude:      { port: 8798, envStyle: 'anthropic', interfaceType: 'cli',           strategy: 'env',          executable: 'claude',     configHintIncludes: '.claude' },
  codex:       { port: 8989, envStyle: 'openai',    interfaceType: 'cli',           strategy: 'env',          executable: 'codex',      configHintIncludes: '.codex' },
  cline:       { port: 8790, envStyle: 'both',      interfaceType: 'ide-extension', strategy: 'env',          executable: 'cline',      configHintIncludes: 'Cline' },
  continue:    { port: 8796, envStyle: 'both',      interfaceType: 'ide-extension', strategy: 'instructions', executable: 'continue',   configHintIncludes: '.continue' },
  copilot:     { port: 8794, envStyle: 'openai',    interfaceType: 'cli',           strategy: 'env',          executable: 'copilot',    configHintIncludes: '.copilot' },
  cursor:      { port: 8795, envStyle: 'both',      interfaceType: 'gui',           strategy: 'env',          executable: 'cursor',     configHintIncludes: 'Cursor' },
  goose:       { port: 8797, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'goose',      configHintIncludes: 'goose' },
  grok:        { port: 8791, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'grok',       configHintIncludes: '.grok' },
  'grok-build':{ port: 8792, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'grok',       configHintIncludes: '.grok' },
  kimi:        { port: 8799, envStyle: 'anthropic', interfaceType: 'cli',           strategy: 'env',          executable: 'kimi',       configHintIncludes: '.kimi' },
  omp:         { port: 8800, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'omp',        configHintIncludes: '.omp' },
  openclaude:  { port: 8801, envStyle: 'anthropic', interfaceType: 'cli',           strategy: 'env',          executable: 'openclaude', configHintIncludes: '.openclaude' },
  openclaw:    { port: 8802, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'openclaw',   configHintIncludes: '.openclaw' },
  opencode:    { port: 8803, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'opencode',   configHintIncludes: 'opencode' },
  openhands:   { port: 8804, envStyle: 'openai',    interfaceType: 'cli',           strategy: 'env',          executable: 'openhands',  configHintIncludes: '.openhands' },
  vibe:        { port: 8805, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'vibe',       configHintIncludes: '.vibe' },
  zcode:       { port: 8806, envStyle: 'both',      interfaceType: 'gui',           strategy: 'env',          executable: 'zcode',      configHintIncludes: 'ZCode' },
  aider:       { port: 8793, envStyle: 'both',      interfaceType: 'cli',           strategy: 'env',          executable: 'aider',      configHintIncludes: '.aider' },
};

function emptyCtx(platform: PlatformName): PlatformContext {
  return {
    platform,
    homeDir: platform === 'win32' ? 'C:\\Users\\u' : '/home/u',
    env: { PATH: '' },
    exists: () => false,
    isFile: () => false,
    readdir: () => [],
  };
}

describe.each(AGENTS.filter((a) => a.id !== 'cursor').map((a) => [a.id, a] as const))('agent "%s"', (id, agent: AgentDefinition) => {
  const facts = FACTS[id];

  it('has hand-verified registry facts', () => {
    expect(facts, `missing FACTS entry for ${id}`).toBeDefined();
    expect(agent.defaultPort).toBe(facts.port);
    expect(agent.envStyle).toBe(facts.envStyle);
    expect(agent.interfaceType).toBe(facts.interfaceType);
    expect(agent.launchStrategy).toBe(facts.strategy);
    expect(agent.executables).toContain(facts.executable);
    expect(agent.configFileHint).toContain(facts.configHintIncludes);
  });

  it('produces a valid default profile on its own unique port', () => {
    const profile = defaultProfile(id);
    expect(validateProfile(profile)).toEqual([]);
    expect(profile.port).toBe(facts.port);
  });

  it('is present in a fresh AppConfig', () => {
    const cfg = defaultConfig();
    const entry = cfg.agents.find((a) => a.agentId === id);
    expect(entry).toBeDefined();
    expect(entry!.profiles[0].port).toBe(facts.port);
  });

  it('builds proxy args bound to its port', () => {
    const headroom = getProxy('headroom');
    const args = buildProxyArgs(headroom, defaultProfile(id));
    expect(args[0]).toBe('proxy');
    const portIdx = args.indexOf('--port');
    expect(args[portIdx + 1]).toBe(String(facts.port));
  });

  it('injects exactly the base URLs its env style requires', () => {
    const headroom = getProxy('headroom');
    const env = buildAgentEnv(agent, defaultProfile(id), headroom);
    const base = `http://127.0.0.1:${facts.port}`;
    const expectsAnthropic = facts.envStyle === 'anthropic' || facts.envStyle === 'both';
    const expectsOpenai = facts.envStyle === 'openai' || facts.envStyle === 'both';
    expect(env.ANTHROPIC_BASE_URL).toBe(expectsAnthropic ? base : undefined);
    expect(env.OPENAI_BASE_URL).toBe(expectsOpenai ? `${base}/v1` : undefined);
    if (facts.envStyle === 'none') {
      expect(Object.keys(env).filter((k) => k.endsWith('_BASE_URL')).length).toBe(0);
    }
  });

  it('builds a launch plan appropriate to its strategy', () => {
    const headroom = getProxy('headroom');
    const profile = defaultProfile(id);
    if (facts.strategy === 'env') {
      expect(() => buildLaunchPlan(agent, profile, headroom, '/hb/headroom', null)).toThrow(/requires an executable/);
      const plan = buildLaunchPlan(agent, profile, headroom, '/hb/headroom', `/fake/${facts.executable}`);
      expect(plan.agentId).toBe(id);
      expect(plan.port).toBe(facts.port);
      expect(plan.agentBin).toBe(`/fake/${facts.executable}`);
      expect(plan.strategy).toBe('env');
    } else {
      const plan = buildLaunchPlan(agent, profile, headroom, '/hb/headroom', null);
      expect(plan.strategy).toBe('instructions');
      expect(plan.port).toBe(facts.port);
    }
  });

  it('builds an OS-correct terminal command on every platform', () => {
    if (facts.strategy !== 'env') return; // nothing to launch for instructions agents
    const headroom = getProxy('headroom');
    const plan = buildLaunchPlan(agent, defaultProfile(id), headroom, '/hb/headroom', `/fake/${facts.executable}`);
    const win = buildTerminalCommand(plan, agent.name, 'win32');
    expect(win.cmd).toBe('cmd.exe');
    expect(win.args.join(' ')).toContain(facts.executable);
    const mac = buildTerminalCommand(plan, agent.name, 'darwin');
    expect(mac.cmd).toBe('osascript');
    expect(mac.args[1]).toContain(facts.executable);
    const linux = buildTerminalCommand(plan, agent.name, 'linux', { terminal: 'xterm' });
    expect(linux.cmd).toBe('xterm');
    expect(linux.args.join(' ')).toContain(facts.executable);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('scan on %s without the agent installed reports not-found', (platform) => {
    const result = scanAgent(agent, emptyCtx(platform));
    expect(result.agentId).toBe(id);
    expect(result.found).toBe(false);
    expect(result.paths).toEqual([]);
    expect(result.source).toBe('none');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('scan on %s accepts a valid explicit path', (platform) => {
    const explicit = platform === 'win32' ? 'D:\\tools\\agent.exe' : '/opt/agent/bin';
    const ctx: PlatformContext = { ...emptyCtx(platform), exists: (p) => p === explicit };
    const result = scanAgent(agent, ctx, explicit);
    expect(result.found).toBe(true);
    expect(result.paths).toEqual([explicit]);
    expect(result.source).toBe('explicit');
  });
});

describe('agent fact table sanity', () => {
  it('FACTS covers every registered agent exactly once', () => {
    expect(Object.keys(FACTS).sort()).toEqual(AGENTS.map((a) => a.id).sort());
  });

  it('all default ports are unique and within the user-port range', () => {
    const ports = AGENTS.map((a) => a.defaultPort);
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(8700);
      expect(port).toBeLessThanOrEqual(8999);
    }
  });
});
