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
  proxyProfilePath,
  saveProxyProfilePath,
  defaultProxyProfile,
  DEFAULT_PROFILE_NAME,
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

describe('mergeConfig', () => {
  it('returns defaults for non-object input', () => {
    expect(mergeConfig(null)).toEqual(defaultConfig());
    expect(mergeConfig('nope')).toEqual(defaultConfig());
    expect(mergeConfig(42)).toEqual(defaultConfig());
  });

  it('carries over proxy binary paths', () => {
    const cfg = mergeConfig({
      proxies: [{ proxyId: 'headroom', profiles: [{ proxyPath: '/opt/bin/headroom' }] }],
    });
    const slot = cfg.proxies.find((p) => p.proxyId === 'headroom')!;
    expect(slot.profiles[0].proxyPath).toBe('/opt/bin/headroom');
  });

  it('drops unknown agents and invalid custom entries', () => {
    const cfg = mergeConfig({
      agents: [{ agentId: 'not-a-real-agent', profiles: [] }],
      customAgents: [{ id: 'custom-x', name: '', binary: '', command: '', args: '', envStyle: 'both', port: 1, workingDirectory: '', envOverrides: {} }],
      customProxies: [{ id: 'custom-p', name: '', binary: '', startCommand: '', baseUrlTemplate: '', envStyle: 'both', port: 1, timeoutMs: 1000 }],
    });
    expect(cfg.agents.some((a) => a.agentId === 'not-a-real-agent')).toBe(false);
    expect(cfg.customAgents.length).toBe(0);
    expect(cfg.customProxies.length).toBe(0);
  });

  it('accepts terminalMode and validates proxyStartupTimeoutMs bounds', () => {
    const cfg = mergeConfig({ terminalMode: 'direct', proxyStartupTimeoutMs: 100 });
    expect(cfg.terminalMode).toBe('direct');
    expect(cfg.proxyStartupTimeoutMs).toBe(60000); // out of range -> default
    const ok = mergeConfig({ proxyStartupTimeoutMs: 5000 });
    expect(ok.proxyStartupTimeoutMs).toBe(5000);
  });

  it('restores activeProfile when valid, falls back to first otherwise', () => {
    const raw = defaultConfig();
    const profileName = raw.agents[0].profiles[0].name;
    const cfg = mergeConfig({
      agents: [{ agentId: raw.agents[0].agentId, activeProfile: profileName, profiles: [] }],
    });
    expect(cfg.agents[0].activeProfile).toBe(profileName);
    const bad = mergeConfig({
      agents: [{ agentId: raw.agents[0].agentId, activeProfile: 'missing', profiles: [] }],
    });
    expect(bad.agents[0].activeProfile).toBe(bad.agents[0].profiles[0].name);
  });

  it('sanitizes profiles that fail validation back to valid defaults', () => {
    const raw = defaultConfig();
    const id = raw.agents[0].agentId;
    const cfg = mergeConfig({
      agents: [{ agentId: id, profiles: [{ name: 'Bad', port: 0 }] }],
    });
    // port 0 fails validation, so the cleaned profile is dropped and the
    // original Default profile is kept.
    expect(cfg.agents[0].profiles[0].name).toBe('Default');
    expect(validateProfile(cfg.agents[0].profiles[0])).toEqual([]);
  });
});

describe('sanitizeProfile', () => {
  it('fills missing fields with sensible defaults', () => {
    const s = sanitizeProfile('codex', { name: 'Custom' });
    expect(s.name).toBe('Custom');
    expect(s.port).toBeGreaterThan(0);
    expect(validateProfile(s)).toEqual([]);
  });
});

describe('proxyProfilePath helpers', () => {
  it('saveProxyProfilePath persists and proxyProfilePath reads back', () => {
    const raw = defaultConfig();
    const id = raw.proxies[0].proxyId;
    saveProxyProfilePath(raw, id, '/custom/px');
    expect(proxyProfilePath(raw, id)).toBe('/custom/px');
  });
});

describe('ConfigStore', () => {
  it('round-trips a config through the in-memory fs', () => {
    const fs = memFs();
    const store = new ConfigStore('config.json', fs);
    const cfg = defaultConfig();
    cfg.defaultCompressor = 'pxpipe';
    store.save(cfg);
    const loaded = store.load();
    expect(loaded.defaultCompressor).toBe('pxpipe');
    expect(loaded.agents.length).toBe(AGENTS.length);
  });

  it('falls back to defaults when the file is missing or corrupt', () => {
    const store = new ConfigStore('config.json', memFs());
    expect(store.load().agents.length).toBe(AGENTS.length);
    const bad = new ConfigStore('config.json', memFs('{ not json'));
    expect(bad.load().agents.length).toBe(AGENTS.length);
  });
});

describe('activeProfile', () => {
  it('resolves the named profile or falls back to the first', () => {
    const cfg = defaultConfig();
    const agentCfg = cfg.agents[0];
    const p = activeProfile(cfg, agentCfg.agentId);
    expect(p).toBeDefined();
  });
});
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
    expect(cfg.defaultCompressor).toBe('headroom');
    expect(cfg.defaultWorkingDirectory).toBe('');
    expect(cfg.terminalFallback).toBe(false);
    expect(cfg.terminalMode).toBe('auto');
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

  it('preserves new settings fields: defaultCompressor, defaultWorkingDirectory, terminalFallback', () => {
    const merged = mergeConfig({
      defaultCompressor: 'rtk',
      defaultWorkingDirectory: '/home/user/projects',
      terminalFallback: true,
    });
    expect(merged.defaultCompressor).toBe('rtk');
    expect(merged.defaultWorkingDirectory).toBe('/home/user/projects');
    expect(merged.terminalFallback).toBe(true);
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

describe('proxyProfilePath / saveProxyProfilePath', () => {
  it('returns empty path when no saved profile exists', () => {
    expect(proxyProfilePath(defaultConfig(), 'headroom')).toBe('');
  });

  it('stores and reads back a compressor binary path', () => {
    const cfg = defaultConfig();
    saveProxyProfilePath(cfg, 'rtk', '/usr/local/bin/rtk');
    expect(proxyProfilePath(cfg, 'rtk')).toBe('/usr/local/bin/rtk');
  });

  it('round-trips through the config store and survives a load', () => {
    const fs = memFs();
    const store = new ConfigStore('config.json', fs);
    const cfg = store.load();
    saveProxyProfilePath(cfg, 'pxpipe', '/opt/pxpipe/pxpipe');
    store.save(cfg);
    expect(proxyProfilePath(store.load(), 'pxpipe')).toBe('/opt/pxpipe/pxpipe');
  });

  it('creates a proxy slot when none exists for a compressor', () => {
    const cfg = defaultConfig();
    const before = cfg.proxies.length;
    saveProxyProfilePath(cfg, 'some-future-compressor', '/x/bin');
    expect(cfg.proxies.length).toBe(before + 1);
    expect(proxyProfilePath(cfg, 'some-future-compressor')).toBe('/x/bin');
  });

  it('defaultProxyProfile produces an empty proxyPath profile with a default port', () => {
    const p = defaultProxyProfile('headroom', DEFAULT_PROFILE_NAME);
    expect(p.proxyPath).toBe('');
    expect(p.port).toBeGreaterThan(0);
  });
});

