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
  if (agent.envStyle === 'anthropic' || agent.envStyle === 'both') {
    env.ANTHROPIC_BASE_URL = base;
  }
  if (agent.envStyle === 'openai' || agent.envStyle === 'both') {
    env.OPENAI_BASE_URL = `${base}/v1`;
  }
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
 */
export function resolveAgentBinary(
  profile: AgentProfile,
  scan?: ScanResult,
): string | null {
  if (profile.agentPath.trim().length > 0) return profile.agentPath.trim();
  if (scan && scan.found && scan.paths.length > 0) return scan.paths[0];
  return null;
}

/** Escape a string for embedding inside a single-quoted Python literal. */
function pyQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Resolve an absolute python interpreter when possible so Electron's stripped
 * PATH still finds one. Falls back to the bare `python3` / `python` name.
 */
export function resolvePythonBinary(
  platform: PlatformName,
  exists: (path: string) => boolean,
  env: Record<string, string | undefined>,
): string {
  const pathValue = env.PATH ?? env.Path ?? '';
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = pathValue.split(sep).filter(Boolean);

  if (platform === 'win32') {
    const candidates = [
      ...dirs.flatMap((d) => [`${d}\\python.exe`, `${d}\\py.exe`]),
      'C:\\Windows\\py.exe',
      'python.exe',
      'py.exe',
      'python',
    ];
    for (const c of candidates) {
      if (c.includes('\\') || c.includes('/')) {
        if (exists(c)) return c;
      }
    }
    return 'python';
  }

  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    ...dirs.map((d) => `${d.replace(/\/$/, '')}/python3`),
  ];
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return 'python3';
}

export type EmbeddedLaunchMethod = 'python-pty' | 'direct';

export interface EmbeddedLaunchCommand {
  method: EmbeddedLaunchMethod;
  cmd: string;
  args: string[];
}

/** Pure builder for the embedded (Workflow) agent spawn command. */
export function buildEmbeddedLaunchCommand(input: {
  platform: PlatformName;
  strategy: LaunchPlan['strategy'];
  agentBin: string;
  agentArgs: string[];
  exists: (path: string) => boolean;
  env: Record<string, string | undefined>;
}): EmbeddedLaunchCommand {
  const bin = input.agentBin;
  const args = input.agentArgs;

  if (input.platform === 'win32' || input.strategy !== 'env') {
    return { method: 'direct', cmd: bin, args: [...args] };
  }

  const python = resolvePythonBinary(input.platform, input.exists, input.env);
  const argv = [bin, ...args].map((a) => `'${pyQuote(a)}'`).join(',');
  const pyScript = [
    'import pty,os,select,sys,signal,fcntl,struct,termios',
    'signal.signal(signal.SIGCHLD, signal.SIG_DFL)',
    'def _winsize():',
    '  try:',
    '    cols=int(os.environ.get("COLUMNS","120")); rows=int(os.environ.get("LINES","40"))',
    '    fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))',
    '  except Exception:',
    '    pass',
    'pid,fd=pty.fork()',
    'if pid==0:',
    '  _winsize()',
    `  os.execv('${pyQuote(bin)}',[${argv}])`,
    'else:',
    '  try:',
    '    cols=int(os.environ.get("COLUMNS","120")); rows=int(os.environ.get("LINES","40"))',
    '    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))',
    '  except Exception:',
    '    pass',
    '  os.set_blocking(sys.stdin.fileno(), False)',
    '  os.set_blocking(fd, False)',
    '  try:',
    '    while True:',
    '      r,_,_=select.select([fd,sys.stdin],[],[],0.1)',
    '      if fd in r:',
    '        try:',
    '          d=os.read(fd,65536)',
    '          if not d: break',
    '          sys.stdout.buffer.write(d)',
    '          sys.stdout.buffer.flush()',
    '        except Exception:',
    '          break',
    '      if sys.stdin in r:',
    '        try:',
    '          d=os.read(sys.stdin.fileno(),65536)',
    '          if not d: break',
    '          os.write(fd,d)',
    '        except Exception:',
    '          break',
    '  except Exception:',
    '    pass',
    '  try:',
    '    os.waitpid(pid,0)',
    '  except Exception:',
    '    pass',
    '  os._exit(0)',
  ].join('\n');

  return { method: 'python-pty', cmd: python, args: ['-u', '-c', pyScript] };
}

/**
 * Format text written to an agent PTY/stdin.
 * Control characters (Ctrl+C / Ctrl+D) are sent as-is; normal lines get a
 * trailing newline unless one is already present.
 */
export function formatStdinPayload(text: string): string {
  if (text === '\u0003' || text === '\u0004') return text;
  if (text.endsWith('\n')) return text;
  return text + '\n';
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
 * Build the OS-specific command that opens the agent in a NEW terminal window.
 */
export function buildTerminalCommand(
  plan: LaunchPlan,
  _agentName: string,
  platform: PlatformName,
  opts: { terminal?: string } = {},
): TerminalCommand {
  const binLine = [quoteArg(plan.agentBin, platform), ...plan.agentArgs.map((a) => quoteArg(a, platform))].join(' ');

  if (platform === 'win32') {
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
  stdin?: NodeJS.WritableStream | null;
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
  /** Optional exists probe used to resolve python / helpers (tests inject). */
  exists?: (path: string) => boolean;
  /** Optional env snapshot for resolving helpers (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

interface RunningEntry {
  runtime: AgentRuntime;
  proxy?: SpawnedProcess;
  agent?: SpawnedProcess;
  agentName?: string;
}

/**
 * Owns the lifecycle of headroom proxy + agent processes for every launch.
 * Keyed by launchId so the same agent can run in multiple tabs concurrently.
 * Emits runtime changes through `onRuntimeChange`.
 */
export class ProcessManager {
  private entries = new Map<string, RunningEntry>();
  private listeners = new Set<(runtime: AgentRuntime) => void>();

  constructor(private readonly deps: ProcessManagerDeps) {
    deps.proxyManager.onRuntimeChange((launchId, proxyRuntime) => {
      const entry = this.entries.get(launchId);
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

  runtimeFor(launchId: string): AgentRuntime {
    return this.entries.get(launchId)?.runtime ?? { id: launchId, agentId: launchId, state: 'stopped' };
  }

  allRuntimes(): AgentRuntime[] {
    return [...this.entries.values()].map((e) => ({ ...e.runtime }));
  }

  /**
   * Start proxy + agent under a launchId. Resolves once the agent is running
   * (or the proxy is up for 'instructions' agents). Rejects on failure with cleanup.
   */
  async start(
    launchId: string,
    plan: LaunchPlan,
    proxyDef: ProxyDefinition,
    proxyBin: string,
    proxyFlags: ProxyFlags,
    agentName: string,
    startupTimeoutMs: number,
    embedded?: boolean,
  ): Promise<AgentRuntime> {
    const existing = this.entries.get(launchId);
    if (existing && existing.runtime.state !== 'stopped' && existing.runtime.state !== 'error') {
      throw new Error(`${launchId} is already ${existing.runtime.state}`);
    }

    const entry: RunningEntry = {
      runtime: { id: launchId, agentId: plan.agentId, state: 'starting', port: plan.port },
      agentName,
    };
    this.entries.set(launchId, entry);
    this.emit(entry);

    // 1. Proxy (via ProxyManager)
    try {
      await this.deps.proxyManager.start(launchId, proxyDef, proxyBin, plan.port, proxyFlags, startupTimeoutMs);
    } catch (err) {
      return this.fail(entry, `Failed to start ${proxyDef.name} proxy: ${String(err)}`);
    }
    entry.runtime.port = plan.port;
    entry.runtime.proxyPid = this.deps.proxyManager.runtimeFor(launchId).pid;

    // 2. Wait for proxy-up state
    if (this.deps.proxyManager.runtimeFor(launchId).state === 'up') {
      entry.runtime.state = 'proxy-up';
      this.emit(entry);
      this.deps.logger.info('proxy', `${proxyDef.name} proxy ready on http://127.0.0.1:${plan.port}`);
    }

    // 3. Agent (unless the strategy only needs the proxy running)
    if (plan.strategy === 'instructions') {
      return { ...entry.runtime };
    }

    try {
      entry.agent = embedded
        ? this.spawnAgentEmbedded(plan, agentName, launchId)
        : this.spawnAgent(plan, agentName, launchId);
    } catch (err) {
      return this.fail(entry, `Failed to launch ${agentName}: ${String(err)}`);
    }
    entry.runtime.agentPid = entry.agent.pid;
    entry.agent.on('exit', (code) => {
      this.deps.logger.info(launchId, `${agentName} exited (code ${String(code)})`);
      entry.runtime.agentPid = undefined;
      if (entry.runtime.state === 'running' || entry.runtime.state === 'proxy-up') {
        // Embedded Workflow sessions end when the agent process dies. External
        // terminal launches keep the proxy up, but for embedded we mark stopped
        // so the UI disables stdin instead of looking "live" with a dead PTY.
        entry.runtime.state = embedded ? 'stopped' : 'proxy-up';
        this.emit(entry);
      }
    });
    entry.agent.on('error', (err) => {
      this.deps.logger.error(launchId, `${agentName} process error: ${String(err)}`);
      if (embedded && entry.runtime.state === 'running') {
        entry.runtime.state = 'error';
        entry.runtime.error = String(err);
        this.emit(entry);
      }
    });

    entry.runtime.state = 'running';
    this.emit(entry);
    return { ...entry.runtime };
  }

  /** Stop the agent (if any) and the proxy for one launch. */
  stop(launchId: string): AgentRuntime {
    const entry = this.entries.get(launchId);
    if (!entry) return { id: launchId, agentId: launchId, state: 'stopped' };
    entry.runtime.state = 'stopping';
    this.emit(entry);
    try {
      entry.agent?.kill();
    } catch {
      /* already gone */
    }
    try {
      this.deps.proxyManager.stop(launchId);
    } catch {
      /* already gone */
    }
    entry.runtime = { id: launchId, agentId: entry.runtime.agentId, state: 'stopped' };
    this.entries.set(launchId, entry);
    this.emit(entry);
    return { ...entry.runtime };
  }

  /** Write text to the agent's stdin for a running launch (line mode). */
  writeStdin(launchId: string, text: string): boolean {
    const entry = this.entries.get(launchId);
    if (!entry || !entry.agent?.stdin) return false;
    try {
      entry.agent.stdin.write(formatStdinPayload(text));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write raw bytes to the agent's stdin (xterm / TUI mode).
   * Does NOT append a newline — the terminal emulator sends its own `\r` / keys.
   */
  writeStdinRaw(launchId: string, text: string): boolean {
    const entry = this.entries.get(launchId);
    if (!entry || !entry.agent?.stdin) return false;
    try {
      entry.agent.stdin.write(text);
      return true;
    } catch {
      return false;
    }
  }

  /** Subscribe to raw PTY/stdout bytes for embedded Workflow terminals. */
  onTerminalData(listener: (launchId: string, data: string) => void): () => void {
    this.terminalListeners.add(listener);
    return () => this.terminalListeners.delete(listener);
  }

  /** Stop everything (app shutdown). */
  stopAll(): void {
    for (const launchId of this.entries.keys()) {
      this.stop(launchId);
    }
    this.deps.proxyManager.stopAll();
  }

  private terminalListeners = new Set<(launchId: string, data: string) => void>();

  private emitTerminalData(launchId: string, data: string): void {
    for (const listener of this.terminalListeners) {
      try {
        listener(launchId, data);
      } catch {
        /* listener errors must not break the manager */
      }
    }
  }

  private spawnAgent(plan: LaunchPlan, agentName: string, launchId: string): SpawnedProcess {
    const isCli = plan.strategy === 'env';
    if (isCli) {
      const terminalCmd = buildTerminalCommand(plan, agentName, this.deps.platform, {
        terminal: this.deps.terminal,
      });
      this.deps.logger.info(
        launchId,
        `Launching ${agentName}: ${terminalCmd.cmd} ${terminalCmd.args.join(' ')}`,
      );
      const proc = this.deps.spawn(terminalCmd.cmd, terminalCmd.args, {
        env: plan.env,
        cwd: plan.cwd,
        detached: true,
      });
      this.pipeLogs(proc, launchId, agentName);
      return proc;
    }
    this.deps.logger.info(launchId, `Launching ${agentName}: ${plan.agentBin} ${plan.agentArgs.join(' ')}`);
    const proc = this.deps.spawn(plan.agentBin, plan.agentArgs, {
      env: plan.env,
      cwd: plan.cwd,
      detached: true,
    });
    this.pipeLogs(proc, launchId, agentName);
    return proc;
  }

  /** Spawn agent directly with a PTY for the embedded Workflow view. */
  private spawnAgentEmbedded(plan: LaunchPlan, agentName: string, launchId: string): SpawnedProcess {
    const bin = plan.agentBin || plan.headroomBin;
    const args = plan.strategy === 'env' ? plan.agentArgs : plan.proxyArgs;
    this.deps.logger.info(launchId, 'Spawning ' + agentName + ': ' + bin);

    const exists = this.deps.exists ?? ((p: string) => {
      try {
        return require('fs').existsSync(p);
      } catch {
        return false;
      }
    });
    const env = this.deps.env ?? (process.env as Record<string, string | undefined>);

    const launch = buildEmbeddedLaunchCommand({
      platform: this.deps.platform,
      strategy: plan.strategy,
      agentBin: bin,
      agentArgs: args,
      exists,
      env,
    });

    if (launch.method === 'python-pty') {
      this.deps.logger.info(launchId, 'PTY launch ' + agentName + ' via ' + launch.cmd);
      const proc = this.deps.spawn(launch.cmd, launch.args, {
        env: {
          ...plan.env,
          TERM: 'xterm-256color',
          PYTHONUNBUFFERED: '1',
          COLUMNS: plan.env.COLUMNS ?? '120',
          LINES: plan.env.LINES ?? '40',
          FORCE_COLOR: '1',
        },
        cwd: plan.cwd,
      });
      this.pipeLogs(proc, launchId, agentName);
      this.pipeTerminalRaw(proc, launchId);
      return proc;
    }

    const proc = this.deps.spawn(launch.cmd, launch.args, {
      env: { ...plan.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      cwd: plan.cwd,
    });
    this.pipeLogs(proc, launchId, agentName);
    this.pipeTerminalRaw(proc, launchId);
    return proc;
  }

  /** Stream raw PTY bytes to Workflow xterm (keeps ANSI / cursor sequences). */
  private pipeTerminalRaw(proc: SpawnedProcess, launchId: string): void {
    const onChunk = (chunk: Buffer) => {
      try {
        this.emitTerminalData(launchId, chunk.toString('utf8'));
      } catch {
        /* ignore */
      }
    };
    try {
      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);
    } catch {
      /* stream may already be destroyed */
    }
  }

  private pipeLogs(proc: SpawnedProcess, source: string, agentName: string): void {
    const onData = (level: 'info' | 'warn') => (chunk: Buffer) => {
      try {
        const text = chunk.toString('utf8').replace(/\s+$/, '');
        for (const line of text.split(/\r?\n/)) {
          if (line.trim().length > 0) this.deps.logger.log(level, source, `[${agentName}] ${line}`);
        }
      } catch {
        /* ignore pipe errors */
      }
    };
    try {
      proc.stdout?.on('data', onData('info'));
      proc.stderr?.on('data', onData('warn'));
    } catch {
      /* stream may already be destroyed */
    }
  }

  private fail(entry: RunningEntry, message: string): AgentRuntime {
    this.deps.logger.error(entry.runtime.agentId, message);
    try {
      entry.agent?.kill();
    } catch {
      /* ignore */
    }
    try {
      this.deps.proxyManager.stop(entry.runtime.id ?? entry.runtime.agentId);
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