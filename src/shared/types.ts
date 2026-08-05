/**
 * Shared type definitions used by main process, renderer and core logic.
 */

export type PlatformName = 'win32' | 'darwin' | 'linux';

/** How the user interacts with the agent itself. */
export type InterfaceType = 'cli' | 'gui' | 'ide-extension';

/**
 * How Headroom support is wired up:
 *  - 'env':          launcher starts a Headroom proxy, then launches the agent
 *                    binary with base-URL environment variables pointing at it.
 *  - 'instructions': launcher starts the proxy and shows the configuration
 *                    instructions for the IDE extension to consume.
 */
export type LaunchStrategy = 'env' | 'instructions';

/** Which base-URL environment variables the agent understands. */
export type EnvStyle = 'anthropic' | 'openai' | 'both' | 'none';

export interface AgentDefinition {
  /** Matches the `headroom wrap <id>` subcommand. */
  id: string;
  name: string;
  vendor: string;
  description: string;
  interfaceType: InterfaceType;
  launchStrategy: LaunchStrategy;
  /** Binary names (without extension) searched on PATH. */
  executables: string[];
  /** Extra well-known install locations per platform ('~' and env vars expanded). */
  wellKnownPaths: Partial<Record<PlatformName, string[]>>;
  /** Which base URL env vars to inject. */
  envStyle: EnvStyle;
  /** Arguments always appended when launching the agent. */
  defaultArgs: string[];
  /** Where this agent keeps its own configuration file (displayed/editable). */
  configFileHint: string;
  /** Default proxy port suggested for this agent (unique per agent). */
  defaultPort: number;
  /** Accent colour used by the UI avatar. */
  accent: string;
  homepage: string;
}

/** A single named, saved configuration set for an agent. */
export interface AgentProfile {
  name: string;
  /** Explicit agent binary path; empty string = auto-detect / PATH. */
  agentPath: string;
  port: number;
  /** When true (default) a free port is auto-assigned at launch, ignoring `port`. Set false to force the fixed `port` value to take effect. */
  autoPort: boolean;
  mode: 'token' | 'cache';
  memory: boolean;
  learn: boolean;
  lossless: boolean;
  noOptimize: boolean;
  /** Extra raw CLI flags appended to `headroom proxy`. */
  extraProxyArgs: string;
  /** Extra raw CLI flags appended to the agent command. */
  extraAgentArgs: string;
  /** Additional environment variables for the agent process. */
  envOverrides: Record<string, string>;
  /** Working directory the agent is launched in. */
  workingDirectory: string;
}

export interface AgentConfig {
  agentId: string;
  /** Profiles saved by the user; always at least one ("Default"). */
  profiles: AgentProfile[];
  /** Name of the profile currently selected. */
  activeProfile: string;
}

/** UI theme preference: follow the OS, or force dark/light. */
export type ThemeMode = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

/** Flags controlling proxy behaviour, mirrored from ProxyDefinition. */
export type ProxyFlags = {
  memory?: boolean;
  learn?: boolean;
  lossless?: boolean;
  noOptimize?: boolean;
  mode?: 'token' | 'cache';
  /** Extra raw CLI flags appended to the proxy start command. */
  extraArgs?: string;
  [key: string]: unknown;
};

/** A single named, saved configuration set for a proxy. */
export interface ProxyProfile {
  name: string;
  /** Proxy binary path; empty string = auto-detect / PATH. */
  proxyPath: string;
  port: number;
  flags: ProxyFlags;
  /** Extra environment variables for the agent process. */
  envOverrides: Record<string, string>;
}

export interface ProxyConfig {
  proxyId: string;
  /** Profiles saved by the user; always at least one ("Default"). */
  profiles: ProxyProfile[];
  /** Name of the profile currently selected. */
  activeProfile: string;
}

export interface AppConfig {
  /** Explicit headroom binary path; empty = auto-detect. */
  headroomPath: string;
  /** How long to wait for the proxy to come up, milliseconds. */
  proxyStartupTimeoutMs: number;
  /** UI theme; 'system' syncs with the OS dark/light setting. */
  theme: ThemeMode;
  /** Default compressor id used when launching without an explicit choice. */
  defaultCompressor: string;
  /** Default working directory for agent launches (empty = user home / cwd). */
  defaultWorkingDirectory: string;
  /** When true, fall back to an external terminal window for agent output. */
  terminalFallback: boolean;
  /** Per-proxy saved profiles. */
  proxies: ProxyConfig[];
  agents: AgentConfig[];
  /** User-defined custom coding agents (id prefix 'custom-agent-'). */
  customAgents: CustomAgent[];
  /** User-defined custom token compressors (id prefix 'custom-proxy-'). */
  customProxies: CustomProxy[];
}

/* ---------------------------- Custom entries ---------------------------- */

/** A user-defined coding agent, added manually when auto-detection misses it. */
export interface CustomAgent {
  /** Unique id, 'custom-agent-<slug>'. */
  id: string;
  name: string;
  /** Absolute path to the executable (empty = rely on command/scan). */
  binary: string;
  /** Raw command line (or just the binary name) used to launch. */
  command: string;
  /** Extra CLI flags appended when launching the agent. */
  args: string;
  envStyle: EnvStyle;
  /** Suggested/used proxy port for this agent. */
  port: number;
  /** Working directory to launch in. */
  workingDirectory: string;
  /** Additional environment variables for the agent process. */
  envOverrides: Record<string, string>;
}

/** A user-defined token compressor, added manually. */
export interface CustomProxy {
  /** Unique id, 'custom-proxy-<slug>'. */
  id: string;
  name: string;
  /** Absolute path to the proxy binary. */
  binary: string;
  /** Raw start-command template; '{port}' is substituted with the port. */
  startCommand: string;
  /** Base URL injected into the agent (e.g. 'http://127.0.0.1:{port}'). */
  baseUrlTemplate: string;
  envStyle: EnvStyle;
  /** Port the compressor listens on. */
  port: number;
  /** How long to wait for the proxy to become ready, ms. */
  timeoutMs: number;
}

/* ------------------------- Compatibility model -------------------------- */

/** Detection status of an installed entry on this machine. */
export type DetectionStatus =
  | 'installed'
  | 'not-found'
  | 'manually-configured'
  | 'invalid-path'
  | 'unsupported';

/** A single compatibility relationship: one compressor supports many agents. */
export interface CompatibilityRule {
  compressorId: string;
  /** '*' means every agent; otherwise an explicit allow-list of agent ids. */
  agentIds: string[];
}

/** Launch history record — one per launched agent tab. */
export interface LaunchRecord {
  id: string;
  agentId: string;
  compressorId: string;
  profile: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  port: number;
  state: RunState;
  startedAt: number;
  stoppedAt?: number;
  /** Most recent per-tab output lines (ring buffer). */
  output: string[];
}

export type ScanSource = 'path' | 'well-known' | 'drive' | 'deep' | 'explicit' | 'none';

export interface ScanResult {
  agentId: string;
  found: boolean;
  /** All verified hits, PATH first then well-known locations. */
  paths: string[];
  source: ScanSource;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  /** 'app' | 'proxy' | agent id */
  source: string;
  message: string;
}

export type RunState =
  | 'stopped'
  | 'starting'
  | 'proxy-up'
  | 'running'
  | 'stopping'
  | 'error';

export interface AgentRuntime {
  /** Launch id (multi-instance key when id !== agentId). */
  id?: string;
  agentId: string;
  state: RunState;
  port?: number;
  proxyPid?: number;
  agentPid?: number;
  error?: string;
  /** LaunchTracker id (Workflow sessions match EventOutput on this). */
  trackerId?: string;
  /** Snapshot of LaunchTracker output at return time (for session hydration). */
  output?: string[];
}

/** A fully-resolved, pure description of what will be executed. */
export interface LaunchPlan {
  agentId: string;
  port: number;
  headroomBin: string;
  proxyArgs: string[];
  agentBin: string;
  agentArgs: string[];
  env: Record<string, string>;
  cwd: string;
  strategy: LaunchStrategy;
}

/** IPC channel names, shared between preload and main. */
export const IPC = {
  AgentsList: 'agents:list',
  ScanAll: 'scan:all',
  ScanAgent: 'scan:agent',
  HeadroomDetect: 'headroom:detect',
  ProxyList: 'proxies:list',
  ProxyDetect: 'proxy:detect',
  InstallProxy: 'proxy:install',
  InstallProxyOptions: 'proxy:install-options',
  UninstallProxy: 'proxy:uninstall',
  UpdateProxy: 'proxy:update',
  InstallAgent: 'agent:install',
  InstallAgentOptions: 'agent:install-options',
  ConfigGet: 'config:get',
  ConfigSave: 'config:save',
  LaunchStart: 'launch:start',
  LaunchStop: 'launch:stop',
  LaunchEmbedded: 'launch:embedded',
  RuntimeAll: 'runtime:all',
  LogsList: 'logs:list',
  LogsClear: 'logs:clear',
  PickExecutable: 'dialog:pick-executable',
  PickDirectory: 'dialog:pick-directory',
  OpenPath: 'shell:open-path',
  OpenUrl: 'shell:open-url',
  PortCheck: 'port:check',
  PortKill: 'port:kill',
  // Full App Redesign / Issue #3 channels
  CompatibilityGet: 'compatibility:get',
  CompatibleAgents: 'compatibility:agents',
  CustomAgentSave: 'custom-agent:save',
  CustomAgentDelete: 'custom-agent:delete',
  CustomProxySave: 'custom-proxy:save',
  CustomProxyDelete: 'custom-proxy:delete',
  LaunchesList: 'launches:list',
  // main -> renderer events
  EventLog: 'event:log',
  EventRuntime: 'event:runtime',
  EventOutput: 'event:output',
  EventTerminalData: 'event:terminal-data',
  ProcessInput: 'process:input',
} as const;
