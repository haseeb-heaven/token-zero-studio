import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/core/agents';
import {
  ConfigFs,
  ConfigStore,
  activeProfile,
  defaultConfig,
  defaultProfile,
  mergeConfig,
  sanitizeProfile,
  validateProfile,
} from '../src/core/config';

function memFs(initial?: string): ConfigFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set('config.json', initial);
  return {
    files,
    readFileSync: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFileSync: (p, data) => void files.set(p, data),
    existsSync: (p) => files.has(p),
    renameSync: (o, n) => {
      files.set(n, files.get(o)!);
      files.delete(o);
    },
  };
}

describe('defaultConfig', () => {
  it('creates one Default profile per agent with registry defaults', () => {
    const cfg = defaultConfig();
    expect(cfg.agents.length).toBe(AGENTS.length);
    for (const agentCfg of cfg.agents) {
      expect(agentCfg.profiles.length).toBe(1);
      expect(agentCfg.activeProfile).toBe('Default');
      const agent = AGENTS.find((a) => a.id === agentCfg.agentId)!;
      expect(agentCfg.profiles[0].port).toBe(agent.defaultPort);
      expect(validateProfile(agentCfg.profiles[0])).toEqual([]);
    }
    expect(cfg.headroomPath).toBe('');
    expect(cfg.proxyStartupTimeoutMs).toBeGreaterThan(0);
  });
});

describe('validateProfile', () => {
  it('accepts a default profile', () => {
    expect(validateProfile(defaultProfile('codex'))).toEqual([]);
  });

  it('rejects bad ports, empty names, bad modes and bad env names', () => {
    const p = defaultProfile('codex');
    expect(validateProfile({ ...p, port: 0 })[0]).toMatch(/Port/);
    expect(validateProfile({ ...p, port: 70000 })[0]).toMatch(/Port/);
    expect(validateProfile({ ...p, port: 87.5 })[0]).toMatch(/Port/);
    expect(validateProfile({ ...p, name: '' })[0]).toMatch(/name/);
    expect(validateProfile({ ...p, mode: 'bogus' as never })[0]).toMatch(/Mode/);
    expect(validateProfile({ ...p, envOverrides: { '1BAD': 'x' } })[0]).toMatch(/environment/);
    expect(validateProfile({ ...p, envOverrides: { GOOD_NAME: 'x' } })).toEqual([]);
  });
});

describe('mergeConfig', () => {
  it('returns defaults for garbage input', () => {
    expect(mergeConfig(null)).toEqual(defaultConfig());
    expect(mergeConfig(42)).toEqual(defaultConfig());
    expect(mergeConfig('str')).toEqual(defaultConfig());
  });

  it('drops unknown agents and keeps known overrides', () => {
    const merged = mergeConfig({
      headroomPath: 'D:\\henv\\Scripts\\headroom.exe',
      agents: [
        { agentId: 'not-real', profiles: [] },
        {
          agentId: 'codex',
          activeProfile: 'Work',
          profiles: [{ ...defaultProfile('codex', 'Work'), port: 9000 }],
        },
      ],
    });
    expect(merged.headroomPath).toBe('D:\\henv\\Scripts\\headroom.exe');
    expect(merged.agents.some((a) => a.agentId === 'not-real')).toBe(false);
    const codex = merged.agents.find((a) => a.agentId === 'codex')!;
    expect(codex.activeProfile).toBe('Work');
    expect(codex.profiles[0].port).toBe(9000);
  });

  it('falls back when activeProfile no longer exists and drops invalid profiles', () => {
    const merged = mergeConfig({
      agents: [
        {
          agentId: 'claude',
          activeProfile: 'Ghost',
          profiles: [{ ...defaultProfile('claude'), port: -5 }],
        },
      ],
    });
    const claude = merged.agents.find((a) => a.agentId === 'claude')!;
    expect(claude.profiles.length).toBe(1); // regenerated default
    expect(claude.activeProfile).toBe('Default');
  });

  it('rejects out-of-range proxy timeout', () => {
    const merged = mergeConfig({ proxyStartupTimeoutMs: 5 });
    expect(merged.proxyStartupTimeoutMs).toBe(60000);
  });
});

describe('sanitizeProfile', () => {
  it('fills missing fields from defaults', () => {
    const p = sanitizeProfile('grok', { name: 'X' });
    expect(p.name).toBe('X');
    expect(p.port).toBe(8791);
    expect(p.memory).toBe(true);
    expect(p.envOverrides).toEqual({});
  });
});

describe('activeProfile', () => {
  it('returns the selected profile and tolerates unknown agents', () => {
    const cfg = defaultConfig();
    const codex = cfg.agents.find((a) => a.agentId === 'codex')!;
    codex.profiles.push({ ...defaultProfile('codex', 'Work'), port: 9999 });
    codex.activeProfile = 'Work';
    expect(activeProfile(cfg, 'codex').port).toBe(9999);
    expect(activeProfile(cfg, 'unknown-agent').name).toBe('Default');
  });
});

describe('ConfigStore', () => {
  it('returns defaults when the file does not exist', () => {
    const store = new ConfigStore('config.json', memFs());
    expect(store.load()).toEqual(defaultConfig());
  });

  it('round-trips a saved config', () => {
    const fs = memFs();
    const store = new ConfigStore('config.json', fs);
    const cfg = defaultConfig();
    cfg.headroomPath = '/usr/local/bin/headroom';
    store.save(cfg);
    expect(new ConfigStore('config.json', fs).load()).toEqual(cfg);
  });

  it('backs up corrupt files and returns defaults', () => {
    const fs = memFs('{not json!!');
    const store = new ConfigStore('config.json', fs);
    expect(store.load()).toEqual(defaultConfig());
    expect(fs.files.has('config.json.corrupt')).toBe(true);
  });

  it('merges older/partial files on load', () => {
    const fs = memFs(JSON.stringify({ agents: [{ agentId: 'kimi', profiles: [{ name: 'P', port: 9500 }] }] }));
    const loaded = new ConfigStore('config.json', fs).load();
    const kimi = loaded.agents.find((a) => a.agentId === 'kimi')!;
    expect(kimi.profiles[0].port).toBe(9500);
    expect(loaded.agents.length).toBe(AGENTS.length);
  });
});
