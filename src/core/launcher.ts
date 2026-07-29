import type {
  AgentDefinition,
  AgentProfile,
  AgentRuntime,
  LaunchPlan,
  PlatformName,
  RunState,
  ScanResult,
} from '../shared/types';
import type { Logger } from './logger';

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

/** Arguments for `headroom proxy ...` derived from a profile. */
export function buildProxyArgs(profile: AgentProfile): string[] {
  const args: string[] = ['proxy', '--port', String(profile.port), '--mode', profile.mode];
  if (profile.noOptimize) args.push('--no-optimize');
  if (profile.lossless) args.push('--lossless');
  if (profile.memory) args.push('--memory');
  if (profile.learn) args.push('--learn');
  args.push(...splitArgs(profile.extraProxyArgs));
  return args;
}

/** Environment variables the agent process receives. */
export function buildAgentEnv(agent: AgentDefinition, profile: AgentProfile): Record<string, string> {
  const env: Record<string, string> = {};
  const base = `http://127.0.0.1:${profile.port}`;
  if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
    env.ANTHROPIC_BASE_URL = base;
  }
  if (agent.envStyle === 'openai' || agent.envStyle === 'both') {
    env.OPENAI_BASE_URL = `${base}/v1`;
  }
  if (profile.memory) env.HEADROOM_MEMORY = 'true';
  if (profile.learn) env.HEADROOM_LEARN = 'true';
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
  headroomBin: string,
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
    headroomBin,
    proxyArgs: buildProxyArgs(profile),
    agentBin: agentBin ?? '',
    agentArgs: [...agent.defaultArgs, ...splitArgs(profile.extraAgentArgs)],
    env: buildAgentEnv(agent, profile),
    cwd: profile.workingDirectory.trim().length > 0 ? profile.workingDirectory.trim() : '.',
    strategy: agent.launchStrategy,
  };
}

/** Quote one argument for a shell/cmd command line. */
export function quoteArg(value: string, platform: PlatformName): string {
  if (platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
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
  agentName: string,
  platform: PlatformName,
  opts: { terminal?: string } = {},
): TerminalCommand {
  const binLine = [quoteArg(plan.agentBin, platform), ...plan.agentArgs.map((a) => quoteArg(a, platform))].join(' ');

  if (platform === 'win32') {
    // Environment is inherited through the spawn env of cmd.exe -> start.
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'start', `"Headroom \u2014 ${agentName}"`, '/D', plan.cwd, 'cmd', '/k', binLine],
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
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll the proxy until it answers HTTP (any status) or the timeout elapses. */
export async function waitForProxyReady(
  port: number,
  timeoutMs: number,
  fetchImpl: FetchFn,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const urls = [`http://127.0.0.1:${port}/livez`, `http://127.0.0.1:${port}/healthz`];
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        await fetchImpl(url);
        return true; // any HTTP response means the server is up
      } catch {
        /* connection refused — keep polling */
      }
    }
    await sleep(intervalMs);
  }
  return false;
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
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ProcessManagerDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
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
  async start(plan: LaunchPlan, agentName: string, startupTimeoutMs: number): Promise<AgentRuntime> {
    const existing = this.entries.get(plan.agentId);
    if (existing && existing.runtime.state !== 'stopped' && existing.runtime.state !== 'error') {
      throw new Error(`${agentName} is already ${existing.runtime.state}`);
    }

    const entry: RunningEntry = {
      runtime: { agentId: plan.agentId, state: 'starting', port: plan.port },
    };
    this.entries.set(plan.agentId, entry);
    this.emit(entry);

    // 1. Headroom proxy
    try {
      entry.proxy = this.deps.spawn(plan.headroomBin, plan.proxyArgs, {
        env: {},
        cwd: plan.cwd === '.' ? process.cwd() : plan.cwd,
      });
    } catch (err) {
      return this.fail(entry, `Failed to start Headroom proxy: ${String(err)}`);
    }
    entry.runtime.proxyPid = entry.proxy.pid;
    this.pipeLogs(entry.proxy, 'proxy', agentName);
    entry.proxy.on('exit', (code) => {
      this.deps.logger.warn('proxy', `Headroom proxy for ${agentName} exited (code ${String(code)})`);
      const s = entry.runtime.state;
      if (s !== 'stopping' && s !== 'stopped' && s !== 'error') {
        entry.runtime.state = 'stopped';
        entry.runtime.proxyPid = undefined;
        entry.runtime.agentPid = undefined;
        this.emit(entry);
      }
    });
    entry.proxy.on('error', (err) => {
      void this.fail(entry, `Headroom proxy error: ${String(err)}`);
    });

    // 2. Wait until the proxy answers
    const ready = await waitForProxyReady(plan.port, startupTimeoutMs, this.deps.fetch, this.sleep);
    if (!ready) {
      return this.fail(entry, `Headroom proxy did not become ready on port ${plan.port} within ${startupTimeoutMs}ms`);
    }
    entry.runtime.state = 'proxy-up';
    this.emit(entry);
    this.deps.logger.info('proxy', `Headroom proxy ready on http://127.0.0.1:${plan.port}`);

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
      entry.proxy?.kill();
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
      return this.deps.spawn(terminalCmd.cmd, terminalCmd.args, {
        env: plan.env,
        cwd: plan.cwd,
        detached: true,
      });
    }
    this.deps.logger.info(plan.agentId, `Launching ${agentName}: ${plan.agentBin} ${plan.agentArgs.join(' ')}`);
    return this.deps.spawn(plan.agentBin, plan.agentArgs, {
      env: plan.env,
      cwd: plan.cwd,
      detached: true,
    });
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
      entry.proxy?.kill();
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
