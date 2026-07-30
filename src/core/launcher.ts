import type {
  AgentDefinition,
  AgentProfile,
  AgentRuntime,
  LaunchPlan,
  PlatformName,
  ProxyFlags,
  RunState,
  ScanResult,
} from '../shared/types';
import type { ProxyDefinition } from './proxies/types';
import type { Logger } from './logger';
import type { ProxyManager } from './proxy-manager';

/* ------------------------------------------------------------------ */
/* Pure plan builders (unit-tested, no side effects)                   */
/* ------------------------------------------------------------------ */

/** Split a raw extra-args string, respecting single/double quotes. */
export function splitArgs(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** Arguments for the proxy start command derived from a profile and definition. */
export function buildProxyArgs(def: ProxyDefinition, profile: AgentProfile): string[] {
  const flags = {
    mode: profile.mode,
    memory: profile.memory,
    learn: profile.learn,
    lossless: profile.lossless,
    noOptimize: profile.noOptimize,
    extraArgs: profile.extraProxyArgs,
  };
  return def.buildStartArgs(profile.port, flags);
}

/** Environment variables the agent process receives. */
export function buildAgentEnv(agent: AgentDefinition, profile: AgentProfile, proxyDef: ProxyDefinition): Record<string, string> {
  const env: Record<string, string> = {};
  const base = `http://127.0.0.1:${profile.port}`;
  // Use the agent's envStyle to determine which base URL vars to set —
  // the agent only reads the ones it knows about.
  if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
    env.ANTHROPIC_BASE_URL = base;
  }
  if (agent.envStyle === 'openai' || agent.envStyle === 'both') {
    env.OPENAI_BASE_URL = `${base}/v1`;
  }
  // Headroom-specific env vars (only relevant for headroom proxy)
  if (proxyDef.id === 'headroom') {
    if (profile.memory) env.HEADROOM_MEMORY = 'true';
    if (profile.learn) env.HEADROOM_LEARN = 'true';
  }
  for (const [key, value] of Object.entries(profile.envOverrides)) {
    env[key] = value;
  }
  return env;
}

/**
 * Decide which binary will be launched:
 * explicit profile path > first scan hit > null.
 * `null` is only acceptable for 'instructions'-strategy agents.
 */
export function resolveAgentBinary(
  profile: AgentProfile,
  scan?: ScanResult,
): string | null {
  if (profile.agentPath.trim().length > 0) return profile.agentPath.trim();
  if (scan && scan.found && scan.paths.length > 0) return scan.paths[0];
  return null;
}

/** Assemble the complete, side-effect-free launch plan. */
export function buildLaunchPlan(
  agent: AgentDefinition,
  profile: AgentProfile,
  proxyDef: ProxyDefinition,
  proxyBin: string,
  agentBin: string | null,
): LaunchPlan {
  if (agent.launchStrategy === 'env' && (!agentBin || agentBin.length === 0)) {
    throw new Error(
      `${agent.name} requires an executable. Configure an explicit path or run a system scan.`,
    );
  }
  return {
    agentId: agent.id,
    port: profile.port,
    headroomBin: proxyBin,
    proxyArgs: buildProxyArgs(proxyDef, profile),
    agentBin: agentBin ?? '',
    agentArgs: [...agent.defaultArgs, ...splitArgs(profile.extraAgentArgs)],
    env: buildAgentEnv(agent, profile, proxyDef),
    cwd: profile.workingDirectory.trim().length > 0 ? profile.workingDirectory.trim() : '.',
    strategy: agent.launchStrategy,
  };
}

/** Quote one argument for a shell/cmd command line. */
export function quoteArg(value: string, platform: PlatformName): string {
  if (platform === 'win32') {
    if (!value) return '""';
    if (value.startsWith('"') && value.endsWith('"')) return value;
    if (/[ &()^=;!%+,\s]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface TerminalCommand {
  cmd: string;
  args: string[];
}

/**
 * Build the OS-specific command that opens the agent in a NEW terminal window
 * (required for interactive CLI agents). GUI agents are spawned directly and
 * do not use this.
 *
 * - Windows: `cmd /c start "title" /D cwd cmd /k "bin args"`
 * - macOS:   `osascript -e 'tell app Terminal to do script "..."'`
 * - Linux:   `<terminal> -e bash -c '<script>'` (gnome-terminal uses `--`)
 */
export function buildTerminalCommand(
  plan: LaunchPlan,
  _agentName: string,
  platform: PlatformName,
  opts: { terminal?: string } = {},
): TerminalCommand {
  const binLine = [quoteArg(plan.agentBin, platform), ...plan.agentArgs.map((a) => quoteArg(a, platform))].join(' ');

  if (platform === 'win32') {
    // Environment is inherited through the spawn env of cmd.exe -> start.
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'start', '""', '/D', plan.cwd, 'cmd', '/k', binLine],
    };
  }

  const exports = Object.entries(plan.env)
    .map(([k, v]) => `export ${k}=${quoteArg(v, platform)}`)
    .join('; ');
  const script = `cd ${quoteArg(plan.cwd, platform)}; ${exports}; ${binLine}`;

  if (platform === 'darwin') {
    const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      cmd: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "${escaped}"`],
    };
  }

  const terminal = opts.terminal ?? 'x-terminal-emulator';
  const dashDash = terminal === 'gnome-terminal' || terminal === 'kgx';
  return {
    cmd: terminal,
    args: [...(dashDash ? ['--'] : ['-e']), 'bash', '-c', `${script}; exec bash`],
  };
}

/* ------------------------------------------------------------------ */
/* Process management (side effects, thin and injectable)              */
/* ------------------------------------------------------------------ */

export interface SpawnedProcess {
  pid?: number;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'exit' | 'error', cb: (...args: unknown[]) => void): void;
  kill(signal?: string): void;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd: string; detached?: boolean },
) => SpawnedProcess;

export type FetchFn = (url: string) => Promise<{ status: number }>;

export interface ProcessManagerDeps {
  spawn: SpawnFn;
  fetch: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  logger: Logger;
  platform: PlatformName;
  /** Linux terminal emulator to use (resolved by caller). */
  terminal?: string;
  /** Proxy manager for starting/stopping the proxy process. */
  proxyManager: ProxyManager;
}

interface RunningEntry {
  runtime: AgentRuntime;
  proxy?: SpawnedProcess;
  agent?: SpawnedProcess;
}

/**
 * Owns the lifecycle of headroom proxy + agent processes for every agent.
 * Emits runtime changes through `onRuntimeChange`.
 */
export class ProcessManager {
  private entries = new Map<string, RunningEntry>();
  private listeners = new Set<(runtime: AgentRuntime) => void>();

  constructor(private readonly deps: ProcessManagerDeps) {
    deps.proxyManager.onRuntimeChange((agentId, proxyRuntime) => {
      const entry = this.entries.get(agentId);
      if (entry && entry.runtime.state !== 'stopped' && entry.runtime.state !== 'error') {
        if (proxyRuntime.state === 'stopped' || proxyRuntime.state === 'error') {
          entry.runtime.state = proxyRuntime.state === 'error' ? 'error' : 'stopped';
          if (proxyRuntime.error) entry.runtime.error = proxyRuntime.error;
          entry.runtime.proxyPid = undefined;
          this.emit(entry);
        }
      }
    });
  }

  onRuntimeChange(listener: (runtime: AgentRuntime) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runtimeFor(agentId: string): AgentRuntime {
    return this.entries.get(agentId)?.runtime ?? { agentId, state: 'stopped' };
  }

  allRuntimes(): AgentRuntime[] {
    return [...this.entries.values()].map((e) => ({ ...e.runtime }));
  }

  /**
   * Start proxy + agent. Resolves once the agent is running (or the proxy is
   * up for 'instructions' agents). Rejects on failure with cleanup done.
   */
  async start(
    plan: LaunchPlan,
    proxyDef: ProxyDefinition,
    proxyBin: string,
    proxyFlags: ProxyFlags,
    agentName: string,
    startupTimeoutMs: number,
  ): Promise<AgentRuntime> {
    const existing = this.entries.get(plan.agentId);
    if (existing && existing.runtime.state !== 'stopped' && existing.runtime.state !== 'error') {
      throw new Error(`${agentName} is already ${existing.runtime.state}`);
    }

    const entry: RunningEntry = {
      runtime: { agentId: plan.agentId, state: 'starting', port: plan.port },
    };
    this.entries.set(plan.agentId, entry);
    this.emit(entry);

    // 1. Proxy (via ProxyManager)
    try {
      await this.deps.proxyManager.start(plan.agentId, proxyDef, proxyBin, plan.port, proxyFlags, startupTimeoutMs);
    } catch (err) {
      return this.fail(entry, `Failed to start ${proxyDef.name} proxy: ${String(err)}`);
    }
    entry.runtime.port = plan.port;
    entry.runtime.proxyPid = this.deps.proxyManager.runtimeFor(plan.agentId).pid;

    // 2. Wait for proxy-up state (wrapper mode resolves immediately)
    if (this.deps.proxyManager.runtimeFor(plan.agentId).state === 'up') {
      entry.runtime.state = 'proxy-up';
      this.emit(entry);
      this.deps.logger.info('proxy', `${proxyDef.name} proxy ready on http://127.0.0.1:${plan.port}`);
    }

    // 3. Agent (unless the strategy only needs the proxy running)
    if (plan.strategy === 'instructions') {
      return { ...entry.runtime };
    }

    try {
      entry.agent = this.spawnAgent(plan, agentName);
    } catch (err) {
      return this.fail(entry, `Failed to launch ${agentName}: ${String(err)}`);
    }
    entry.runtime.agentPid = entry.agent.pid;
    entry.agent.on('exit', (code) => {
      this.deps.logger.info(plan.agentId, `${agentName} exited (code ${String(code)})`);
      entry.runtime.agentPid = undefined;
      if (entry.runtime.state === 'running') {
        entry.runtime.state = 'proxy-up'; // proxy stays alive for a re-launch
        this.emit(entry);
      }
    });
    entry.agent.on('error', (err) => {
      this.deps.logger.error(plan.agentId, `${agentName} process error: ${String(err)}`);
    });

    entry.runtime.state = 'running';
    this.emit(entry);
    return { ...entry.runtime };
  }

  /** Stop the agent (if any) and the proxy for one agent. */
  stop(agentId: string): AgentRuntime {
    const entry = this.entries.get(agentId);
    if (!entry) return { agentId, state: 'stopped' };
    entry.runtime.state = 'stopping';
    this.emit(entry);
    try {
      entry.agent?.kill();
    } catch {
      /* already gone */
    }
    try {
      this.deps.proxyManager.stop(agentId);
    } catch {
      /* already gone */
    }
    entry.runtime = { agentId, state: 'stopped' };
    this.entries.set(agentId, entry);
    this.emit(entry);
    return { ...entry.runtime };
  }

  /** Stop everything (app shutdown). */
  stopAll(): void {
    for (const agentId of this.entries.keys()) {
      this.stop(agentId);
    }
    this.deps.proxyManager.stopAll();
  }

  private spawnAgent(plan: LaunchPlan, agentName: string): SpawnedProcess {
    const isCli = plan.strategy === 'env';
    if (isCli) {
      // Interactive CLIs need their own terminal window; GUIs detach directly.
      const terminalCmd = buildTerminalCommand(plan, agentName, this.deps.platform, {
        terminal: this.deps.terminal,
      });
      this.deps.logger.info(
        plan.agentId,
        `Launching ${agentName}: ${terminalCmd.cmd} ${terminalCmd.args.join(' ')}`,
      );
      const proc = this.deps.spawn(terminalCmd.cmd, terminalCmd.args, {
        env: plan.env,
        cwd: plan.cwd,
        detached: true,
      });
      this.pipeLogs(proc, plan.agentId, agentName);
      return proc;
    }
    this.deps.logger.info(plan.agentId, `Launching ${agentName}: ${plan.agentBin} ${plan.agentArgs.join(' ')}`);
    const proc = this.deps.spawn(plan.agentBin, plan.agentArgs, {
      env: plan.env,
      cwd: plan.cwd,
      detached: true,
    });
    this.pipeLogs(proc, plan.agentId, agentName);
    return proc;
  }

  private pipeLogs(proc: SpawnedProcess, source: string, agentName: string): void {
    const onData = (level: 'info' | 'warn') => (chunk: Buffer) => {
      const text = chunk.toString('utf8').replace(/\s+$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) this.deps.logger.log(level, source, `[${agentName}] ${line}`);
      }
    };
    proc.stdout?.on('data', onData('info'));
    proc.stderr?.on('data', onData('warn'));
  }

  private fail(entry: RunningEntry, message: string): AgentRuntime {
    this.deps.logger.error(entry.runtime.agentId, message);
    try {
      entry.agent?.kill();
    } catch {
      /* ignore */
    }
    try {
      this.deps.proxyManager.stop(entry.runtime.agentId);
    } catch {
      /* ignore */
    }
    entry.runtime = { ...entry.runtime, state: 'error', error: message };
    this.emit(entry);
    throw new Error(message);
  }

  private emit(entry: RunningEntry): void {
    const snapshot = { ...entry.runtime };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* listener errors must not break the manager */
      }
    }
  }
}

export type { RunState };
