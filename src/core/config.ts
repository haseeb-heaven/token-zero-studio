import { AGENTS, getAgent } from './agents';
import { PROXIES, getProxy } from './proxies/registry';
import { isThemeMode } from './theme';
import type { AgentConfig, AgentProfile, AppConfig, ProxyProfile } from '../shared/types';

export const DEFAULT_PROFILE_NAME = 'Default';
/** First proxy boot loads compression models and can easily exceed 30s. */
export const DEFAULT_PROXY_TIMEOUT_MS = 60000;

/** Create a fresh profile pre-filled with an agent's defaults. */
export function defaultProfile(agentId: string, name = DEFAULT_PROFILE_NAME): AgentProfile {
  const agent = getAgent(agentId);
  return {
    name,
    agentPath: '',
    port: agent.defaultPort,
    mode: 'cache',
    memory: true,
    learn: true,
    lossless: false,
    noOptimize: false,
    extraProxyArgs: '',
    extraAgentArgs: '',
    envOverrides: {},
    workingDirectory: '',
  };
}

/** Create a fresh proxy profile pre-filled with a proxy's defaults. */
export function defaultProxyProfile(proxyId: string, name = DEFAULT_PROFILE_NAME): ProxyProfile {
  const proxy = getProxy(proxyId);
  return {
    name,
    proxyPath: '',
    port: proxy.defaultPort,
    flags: { ...proxy.defaultFlags },
    envOverrides: {},
  };
}

/** Validation errors as human-readable strings (empty array = valid). */
export function validateProfile(profile: AgentProfile): string[] {
  const errors: string[] = [];
  if (!profile.name || profile.name.trim().length === 0) {
    errors.push('Profile name must not be empty');
  }
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    errors.push(`Port must be an integer between 1 and 65535 (got ${profile.port})`);
  }
  if (profile.mode !== 'token' && profile.mode !== 'cache') {
    errors.push(`Mode must be "token" or "cache" (got "${profile.mode}")`);
  }
  for (const key of Object.keys(profile.envOverrides ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`Invalid environment variable name: "${key}"`);
    }
  }
  return errors;
}

/** A pristine AppConfig with one Default profile per registered agent. */
export function defaultConfig(): AppConfig {
  return {
    headroomPath: '',
    proxyStartupTimeoutMs: DEFAULT_PROXY_TIMEOUT_MS,
    theme: 'system',
    activeProxy: 'headroom',
    proxies: PROXIES.map((proxy) => ({
      proxyId: proxy.id,
      profiles: [defaultProxyProfile(proxy.id)],
      activeProfile: DEFAULT_PROFILE_NAME,
    })),
    agents: AGENTS.map((agent) => ({
      agentId: agent.id,
      profiles: [defaultProfile(agent.id)],
      activeProfile: DEFAULT_PROFILE_NAME,
    })),
  };
}

/**
 * Merge arbitrary (possibly partial / from an older version) parsed JSON into
 * a complete AppConfig. Unknown agents are dropped; missing ones are added;
 * every agent keeps at least one valid profile.
 */
export function mergeConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return base;
  const input = raw as Partial<AppConfig>;

  if (typeof input.headroomPath === 'string') base.headroomPath = input.headroomPath;
  if (isThemeMode(input.theme)) base.theme = input.theme;
  if (
    typeof input.proxyStartupTimeoutMs === 'number' &&
    Number.isInteger(input.proxyStartupTimeoutMs) &&
    input.proxyStartupTimeoutMs >= 1000 &&
    input.proxyStartupTimeoutMs <= 300000
  ) {
    base.proxyStartupTimeoutMs = input.proxyStartupTimeoutMs;
  }

  if (Array.isArray(input.agents)) {
    for (const rawAgent of input.agents) {
      if (typeof rawAgent !== 'object' || rawAgent === null) continue;
      const agentCfg = rawAgent as Partial<AgentConfig>;
      if (typeof agentCfg.agentId !== 'string') continue;
      const slot = base.agents.find((a) => a.agentId === agentCfg.agentId);
      if (!slot) continue; // unknown agent - drop

      if (Array.isArray(agentCfg.profiles)) {
        const cleaned = agentCfg.profiles
          .filter((p): p is AgentProfile => typeof p === 'object' && p !== null)
          .map((p) => sanitizeProfile(slot.agentId, p))
          .filter((p) => validateProfile(p).length === 0);
        if (cleaned.length > 0) slot.profiles = cleaned;
      }
      if (
        typeof agentCfg.activeProfile === 'string' &&
        slot.profiles.some((p) => p.name === agentCfg.activeProfile)
      ) {
        slot.activeProfile = agentCfg.activeProfile;
      } else {
        slot.activeProfile = slot.profiles[0].name;
      }
    }
  }
  return base;
}

/** Fill missing profile fields with defaults (tolerates old config files). */
export function sanitizeProfile(agentId: string, raw: Partial<AgentProfile>): AgentProfile {
  const base = defaultProfile(agentId);
  const out: AgentProfile = { ...base, ...raw, name: raw.name ?? base.name };
  out.envOverrides =
    typeof raw.envOverrides === 'object' && raw.envOverrides !== null ? { ...raw.envOverrides } : {};
  out.agentPath = typeof out.agentPath === 'string' ? out.agentPath : '';
  out.extraProxyArgs = typeof out.extraProxyArgs === 'string' ? out.extraProxyArgs : '';
  out.extraAgentArgs = typeof out.extraAgentArgs === 'string' ? out.extraAgentArgs : '';
  out.workingDirectory = typeof out.workingDirectory === 'string' ? out.workingDirectory : '';
  return out;
}

/** Get the active profile for an agent (never throws, even for unknown ids). */
export function activeProfile(config: AppConfig, agentId: string): AgentProfile {
  const agentCfg = config.agents.find((a) => a.agentId === agentId);
  if (!agentCfg) {
    // Unknown/removed agent - return a harmless synthetic profile.
    return {
      name: DEFAULT_PROFILE_NAME,
      agentPath: '',
      port: 8989,
      mode: 'cache',
      memory: true,
      learn: true,
      lossless: false,
      noOptimize: false,
      extraProxyArgs: '',
      extraAgentArgs: '',
      envOverrides: {},
      workingDirectory: '',
    };
  }
  return (
    agentCfg.profiles.find((p) => p.name === agentCfg.activeProfile) ?? agentCfg.profiles[0]
  );
}

/** Minimal file-system surface needed by ConfigStore (injectable for tests). */
export interface ConfigFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  existsSync(path: string): boolean;
  renameSync(oldPath: string, newPath: string): void;
}

/**
 * JSON-file-backed configuration store. Tolerates missing/corrupt files:
 * a corrupt file is preserved as `<file>.corrupt` and defaults are returned.
 */
export class ConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly fs: ConfigFs,
  ) {}

  load(): AppConfig {
    if (!this.fs.existsSync(this.filePath)) {
      return defaultConfig();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      try {
        this.fs.renameSync(this.filePath, this.filePath + '.corrupt');
      } catch {
        /* best effort */
      }
      return defaultConfig();
    }
    return mergeConfig(parsed);
  }

  save(config: AppConfig): void {
    const data = JSON.stringify(config, null, 2);
    this.fs.writeFileSync(this.filePath, data, 'utf8');
  }

  get path(): string {
    return this.filePath;
  }
}
