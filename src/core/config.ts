import { AGENTS, getAgent } from './agents';
import { PROXIES, getProxy } from './proxies/registry';
import { isThemeMode } from './theme';
import * as path from 'node:path';
import type {
  AgentConfig,
  AgentDefinition,
  AgentProfile,
  AppConfig,
  CustomAgent,
  CustomProxy,
  ProxyFlags,
  ProxyProfile,
} from '../shared/types';
import type { ProxyDefinition, ProxyMode, ProxyEnvStyle } from './proxies/types';
import { splitArgs } from './launcher';

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
    autoPort: true,
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

/** Resolve the saved binary path for a compressor ('' = auto-detect). */
export function proxyProfilePath(config: AppConfig, proxyId: string): string {
  const slot = config.proxies.find((p) => p.proxyId === proxyId);
  const active = slot?.profiles.find((p) => p.name === slot.activeProfile);
  return active?.proxyPath ?? slot?.profiles[0]?.proxyPath ?? '';
}

/** Persist a compressor binary path into its saved proxy profile. */
export function saveProxyProfilePath(config: AppConfig, proxyId: string, proxyPath: string): void {
  let slot = config.proxies.find((p) => p.proxyId === proxyId);
  if (!slot) {
    slot = {
      proxyId,
      profiles: [{ name: DEFAULT_PROFILE_NAME, proxyPath: '', port: 8199, flags: {}, envOverrides: {} }],
      activeProfile: DEFAULT_PROFILE_NAME,
    };
    config.proxies.push(slot);
  }
  const active = slot.profiles.find((p) => p.name === slot.activeProfile) ?? slot.profiles[0];
  active.proxyPath = proxyPath;
}

/** Id prefixes reserved for custom (user-defined) entries. */
export const CUSTOM_AGENT_PREFIX = 'custom-agent-';
export const CUSTOM_PROXY_PREFIX = 'custom-proxy-';

/** Slugify a name into a safe, unique id fragment. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'custom'
  );
}

/** Build a fresh custom agent from a bare name (id unique via slug). */
export function defaultCustomAgent(name: string, existing: CustomAgent[] = []): CustomAgent {
  const base = slugify(name);
  let id = `${CUSTOM_AGENT_PREFIX}${base}`;
  let n = 2;
  while (existing.some((c) => c.id === id)) id = `${CUSTOM_AGENT_PREFIX}${base}-${n++}`;
  return {
    id,
    name: name.trim(),
    binary: '',
    command: '',
    args: '',
    envStyle: 'both',
    port: 8820,
    workingDirectory: '',
    envOverrides: {},
  };
}

/** Build a fresh custom proxy from a bare name (id unique via slug). */
export function defaultCustomProxy(name: string, existing: CustomProxy[] = []): CustomProxy {
  const base = slugify(name);
  let id = `${CUSTOM_PROXY_PREFIX}${base}`;
  let n = 2;
  while (existing.some((c) => c.id === id)) id = `${CUSTOM_PROXY_PREFIX}${base}-${n++}`;
  return {
    id,
    name: name.trim(),
    binary: '',
    startCommand: '--port {port}',
    baseUrlTemplate: 'http://127.0.0.1:{port}',
    envStyle: 'both',
    port: 8199,
    timeoutMs: DEFAULT_PROXY_TIMEOUT_MS,
  };
}

/** Validation errors for a custom agent (empty array = valid). */
export function validateCustomAgent(agent: CustomAgent): string[] {
  const errors: string[] = [];
  if (!agent.name || agent.name.trim().length === 0) errors.push('Name is required');
  if (!agent.command.trim() && !agent.binary.trim()) errors.push('Command or binary path is required');
  if (!Number.isInteger(agent.port) || agent.port < 1 || agent.port > 65535) {
    errors.push(`Port must be 1-65535 (got ${agent.port})`);
  }
  for (const key of Object.keys(agent.envOverrides ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`Invalid env var name: "${key}"`);
  }
  return errors;
}

/** Validation errors for a custom proxy (empty array = valid). */
export function validateCustomProxy(proxy: CustomProxy): string[] {
  const errors: string[] = [];
  if (!proxy.name || proxy.name.trim().length === 0) errors.push('Name is required');
  if (!proxy.binary.trim()) errors.push('Binary path is required');
  if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    errors.push(`Port must be 1-65535 (got ${proxy.port})`);
  }
  return errors;
}

/**
 * Convert a custom agent into a first-class AgentDefinition so the existing
 * scanner, launcher and compatibility layers treat it uniformly.
 */
export function customAgentToDefinition(custom: CustomAgent): AgentDefinition {
  const executable = (custom.binary || custom.command).trim().split(/\s+/)[0] || custom.name;
  return {
    id: custom.id,
    name: custom.name,
    vendor: 'Custom',
    description: 'User-defined coding agent.',
    interfaceType: 'cli',
    launchStrategy: 'env',
    executables: [path.basename(executable).replace(/\.[^.]+$/, ''), executable],
    wellKnownPaths: {},
    envStyle: custom.envStyle,
    defaultArgs: splitArgs(custom.args),
    configFileHint: '',
    defaultPort: custom.port,
    accent: '#94a3b8',
    homepage: '',
  };
}

/**
 * Convert a custom proxy into a first-class ProxyDefinition. The start command
 * template is rendered with the chosen port. `executables[0]` is the binary
 * basename so PATH scanning can locate it, and the full configured binary path
 * is preferred when present.
 */
export function customProxyToDefinition(custom: CustomProxy, binaryPath?: string): ProxyDefinition {
  const binary = (binaryPath || custom.binary).trim();
  const plain = binary.replace(/^"(.*)"$/, '$1');
  const exeName = path.basename(plain).replace(/\.[^.]+$/, '') || custom.name;
  const render = (tpl: string, port: number): string[] => splitArgs(tpl.replace(/\{port\}/g, String(port)));
  return {
    id: custom.id,
    name: custom.name,
    description: 'User-defined token compressor.',
    mode: 'server' as ProxyMode,
    executables: [exeName, custom.binary],
    wellKnownPaths: {},
    detectCommand: `${exeName} --version`,
    defaultPort: custom.port,
    defaultFlags: {} as ProxyFlags,
    buildStartArgs: (port) => render(custom.startCommand, port),
    envStyle: custom.envStyle as ProxyEnvStyle,
    installInstructions: 'User-managed. Configure the binary path in Token Compressors.',
    accent: '#94a3b8',
    homepage: '',
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
    theme: 'light',
    defaultCompressor: 'headroom',
    defaultWorkingDirectory: '',
    terminalFallback: false,
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
    customAgents: [],
    customProxies: [],
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
  if (typeof input.defaultCompressor === 'string') base.defaultCompressor = input.defaultCompressor;
  if (typeof input.defaultWorkingDirectory === 'string') base.defaultWorkingDirectory = input.defaultWorkingDirectory;
  if (typeof input.terminalFallback === 'boolean') base.terminalFallback = input.terminalFallback;
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

  // Carry over saved per-compressor binary paths (proxy profiles).
  if (Array.isArray(input.proxies)) {
    for (const rawSlot of input.proxies) {
      if (typeof rawSlot !== 'object' || rawSlot === null) continue;
      const slot = rawSlot as { proxyId?: unknown; profiles?: unknown };
      if (typeof slot.proxyId !== 'string') continue;
      const target = base.proxies.find((p) => p.proxyId === slot.proxyId);
      if (!target) continue;
      if (Array.isArray(slot.profiles) && slot.profiles.length > 0) {
        const first = slot.profiles[0] as { proxyPath?: unknown };
        if (first && typeof first === 'object' && typeof first.proxyPath === 'string') {
          target.profiles[0].proxyPath = first.proxyPath;
          target.activeProfile = target.profiles[0].name;
        }
      }
    }
  }

  // Carry over user-defined custom agents / compressors (validated).
  if (Array.isArray(input.customAgents)) {
    base.customAgents = input.customAgents.filter(
      (c): c is CustomAgent =>
        typeof c === 'object' && c !== null && typeof c.name === 'string' && typeof c.id === 'string' && validateCustomAgent(c).length === 0,
    );
  }
  if (Array.isArray(input.customProxies)) {
    base.customProxies = input.customProxies.filter(
      (c): c is CustomProxy =>
        typeof c === 'object' && c !== null && typeof c.name === 'string' && typeof c.id === 'string' && validateCustomProxy(c).length === 0,
    );
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
      autoPort: true,
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
