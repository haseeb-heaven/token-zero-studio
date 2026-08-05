import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { AGENTS, getAgent } from '../core/agents';
import {
  ConfigStore,
  activeProfile,
  validateProfile,
  defaultCustomAgent,
  defaultCustomProxy,
  validateCustomAgent,
  validateCustomProxy,
  customAgentToDefinition,
  customProxyToDefinition,
  proxyProfilePath,
  CUSTOM_AGENT_PREFIX,
  DEFAULT_PROFILE_NAME,
} from '../core/config';
import { compatibleAgentIds } from '../core/compatibility';
import { LaunchTracker, resolveTrackerId } from '../core/launch-records';
import { PortAllocator, chooseLaunchPort } from '../core/port-allocator';
import { ProcessManager, SpawnedProcess, buildLaunchPlan, resolveAgentBinary } from '../core/launcher';
import { Logger } from '../core/logger';
import { currentPlatformContext, mergePathWithUserBins, splitPathEnv } from '../core/platform';
import { ProxyManager } from '../core/proxy-manager';
import { formatInstallOutcome, getProxyInstallOptions, resolveInstallShell } from '../core/proxy-install';
import { getAgentInstallOptions } from '../core/agent-install';
import { PROXIES, getProxy } from '../core/proxies/registry';
import type { ProxyDefinition } from '../core/proxies/types';
import { scanAgent } from '../core/scanner';
import type {
  AgentDefinition,
  AgentProfile,
  AppConfig,
  CustomAgent,
  CustomProxy,
  IPC as IPCTypes,
  ScanResult,
} from '../shared/types';
import { IPC } from '../shared/types';

function proxyToAgentDef(proxy: ProxyDefinition): AgentDefinition {
  return {
    id: proxy.id,
    name: proxy.name,
    vendor: proxy.name,
    description: proxy.description,
    interfaceType: 'cli',
    launchStrategy: 'env',
    executables: proxy.executables,
    wellKnownPaths: proxy.wellKnownPaths,
    envStyle: proxy.envStyle,
    defaultArgs: [],
    configFileHint: '',
    defaultPort: proxy.defaultPort,
    accent: proxy.accent,
    homepage: proxy.homepage,
  };
}

/** A JSON-serializable snapshot of a ProxyDefinition (Electron IPC cannot clone functions). */
function serializeProxy(proxy: ProxyDefinition) {
  return {
    id: proxy.id,
    name: proxy.name,
    description: proxy.description,
    mode: proxy.mode,
    executables: proxy.executables,
    wellKnownPaths: proxy.wellKnownPaths,
    detectCommand: proxy.detectCommand,
    defaultPort: proxy.defaultPort,
    defaultFlags: proxy.defaultFlags,
    envStyle: proxy.envStyle,
    installInstructions: proxy.installInstructions,
    accent: proxy.accent,
    homepage: proxy.homepage,
  };
}

/** Built-in plus user-defined compressors, as first-class definitions. */
function getAllCompressors(config: AppConfig): ProxyDefinition[] {
  return [...PROXIES, ...config.customProxies.map((c) => customProxyToDefinition(c))];
}

/** Resolve a proxy definition, including user-defined compressors. */
function getProxyDef(config: AppConfig, proxyId: string): ProxyDefinition {
  try {
    return getProxy(proxyId);
  } catch {
    const custom = config.customProxies.find((c) => c.id === proxyId);
    if (custom) return customProxyToDefinition(custom);
    return getProxy('headroom');
  }
}

/** Resolve an agent definition, including user-defined agents. */
function getAgentDef(config: AppConfig, agentId: string): AgentDefinition {
  try {
    return getAgent(agentId);
  } catch {
    const custom = config.customAgents.find((c) => c.id === agentId);
    if (custom) return customAgentToDefinition(custom);
    throw new Error(`Unknown agent id: ${agentId}`);
  }
}

/**
 * Resolve the agent definition + profile to launch. Custom agents have no saved
 * profile slot, so a synthetic profile is derived from the custom entry.
 */
function resolveAgentForLaunch(
  config: AppConfig,
  agentId: string,
): { agent: AgentDefinition; profile: AgentProfile; profileErr?: string } {
  if (agentId.startsWith(CUSTOM_AGENT_PREFIX)) {
    const custom = config.customAgents.find((c) => c.id === agentId);
    if (!custom) return { agent: getAgentDef(config, agentId), profile: activeProfile(config, agentId), profileErr: `Unknown custom agent: ${agentId}` };
    const errors = validateCustomAgent(custom);
    if (errors.length > 0) return { agent: customAgentToDefinition(custom), profile: activeProfile(config, agentId), profileErr: `${custom.name}: ${errors.join('; ')}` };
    const profile: AgentProfile = {
      name: DEFAULT_PROFILE_NAME,
      agentPath: custom.binary,
      port: custom.port,
      autoPort: true,
      mode: 'cache',
      memory: false,
      learn: false,
      lossless: false,
      noOptimize: false,
      extraProxyArgs: '',
      extraAgentArgs: custom.args,
      envOverrides: custom.envOverrides,
      workingDirectory: custom.workingDirectory,
    };
    return { agent: customAgentToDefinition(custom), profile };
  }
  const agent = getAgentDef(config, agentId);
  const errors = validateProfile(activeProfile(config, agentId));
  if (errors.length > 0) return { agent, profile: activeProfile(config, agentId), profileErr: errors.join('; ') };
  return { agent, profile: activeProfile(config, agentId) };
}


const logger = new Logger(3000);
let manager: ProcessManager | null = null;
let store: ConfigStore | null = null;

function platformCtx() {
  return currentPlatformContext((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** Real child-process spawn adapted to the ProcessManager contract. */
function realSpawn(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd: string; detached?: boolean },
): SpawnedProcess {
  const cwd = opts.cwd === '.' ? process.cwd() : opts.cwd;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const basePath = process.env.PATH ?? process.env.Path ?? '';
  const mergedPath = mergePathWithUserBins(basePath, process.platform as 'darwin' | 'linux' | 'win32', home);
  const child = nodeSpawn(cmd, args, {
    env: { ...process.env, PATH: mergedPath, ...opts.env },
    cwd,
    detached: opts.detached ?? false,
    windowsHide: false,
    shell: false,
  });
  if (opts.detached) child.unref();
  return child as unknown as SpawnedProcess;
}

/** Resolve a usable Linux terminal emulator, if any. */
function detectTerminal(ctx = platformCtx()): string | undefined {
  if (ctx.platform !== 'linux') return undefined;
  const candidates = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kgx', 'alacritty', 'xterm'];
  const pathDirs = (ctx.env.PATH ?? '').split(':');
  for (const term of candidates) {
    for (const dir of pathDirs) {
      if (ctx.exists(path.join(dir, term))) return term;
    }
  }
  return undefined;
}

/** True when a TCP connect to 127.0.0.1:port fails (i.e. the port is free). */
function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** Kill all processes listening on a TCP port (cross-platform). */
async function killPort(port: number): Promise<{ killed: number; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const child = nodeSpawn('cmd.exe', ['/c', 'netstat -ano'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });
      child.on('close', () => {
        const pids = new Set<number>();
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const localAddr = parts[1];
              const pidStr = parts[parts.length - 1];
              if (localAddr.endsWith(`:${port}`) || localAddr.endsWith(`]:${port}`)) {
                const pid = parseInt(pidStr, 10);
                if (pid && pid > 0) {
                  pids.add(pid);
                }
              }
            }
          }
        }
        if (pids.size === 0) {
          resolve({ killed: 0 });
          return;
        }
        let killedCount = 0;
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
            killedCount++;
          } catch {
            try {
              nodeSpawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
              killedCount++;
            } catch {
              /* ignore */
            }
          }
        }
        resolve({ killed: killedCount });
      });
      child.on('error', (err) => resolve({ killed: 0, error: String(err) }));
      return;
    }
    const child = nodeSpawn('sh', ['-c', `lsof -ti :${port} | xargs kill -9 2>/dev/null || true`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('close', () => resolve({ killed: 1 }));
    child.on('error', (err) => resolve({ killed: 0, error: String(err) }));
  });
}

async function realFetch(url: string): Promise<{ status: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  return { status: res.status };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const ctx = platformCtx();
  store = new ConfigStore(path.join(app.getPath('userData'), 'config.json'), fs);
  const proxyManager = new ProxyManager({
    spawn: realSpawn,
    fetch: realFetch,
    logger,
    platform: ctx.platform,
  });
  manager = new ProcessManager({
    spawn: realSpawn,
    fetch: realFetch,
    logger,
    platform: ctx.platform,
    terminal: detectTerminal(ctx),
    proxyManager,
  });

  const send = (channel: string, payload: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  logger.subscribe((entry) => send(IPC.EventLog, entry));

  // Launch/tab tracking: route logger output and runtime state into records.
  // Declared before onRuntimeChange so the alloc→tracker map is in scope.
  const launches = new LaunchTracker();
  const launchByAlloc = new Map<string, string>(); // port-alloc id -> launch tracker id

  manager.onRuntimeChange((runtime) => {
    send(IPC.EventRuntime, runtime);
    const allocId = runtime.id;
    if (!allocId) return;
    // ProcessManager keys by alloc id (codex-1); LaunchTracker keys by
    // launch-… — must translate or setState/get are silent no-ops.
    const trackerId = resolveTrackerId(launchByAlloc, allocId);
    if (!trackerId) return;
    launches.setState(trackerId, runtime.state);
    const record = launches.get(trackerId);
    if (record) send(IPC.EventOutput, record);
  });

  logger.subscribe((entry) => {
    // Prefer exact launchId match (embedded/CLI logs use the alloc id as source).
    let allocId: string | undefined = launchByAlloc.has(entry.source) ? entry.source : undefined;
    if (!allocId) {
      // Fallback: agentId-prefixed sources (legacy / proxy logs).
      allocId = [...launchByAlloc.keys()].find((k) => k.startsWith(entry.source + '-'));
    }
    if (allocId) {
      const tid = launchByAlloc.get(allocId);
      if (tid) {
        const prev = launches.get(tid)?.output;
        launches.appendOutput(tid, entry.message);
        if (prev !== undefined && prev.length !== launches.get(tid)?.output.length) {
          send(IPC.EventOutput, launches.get(tid));
        }
      }
    }
  });

  logger.info('app', `TokenZeroStudio starting on ${ctx.platform}`);
  logger.info('app', `Config file: ${store.path}`);

  /* ------------------------------ queries ------------------------------ */

  ipcMain.handle(IPC.AgentsList, () => AGENTS);

  ipcMain.handle(IPC.ScanAll, (): ScanResult[] => {
    const config = store!.load();
    const results = AGENTS.map((agent) => scanAgent(agent, ctx, activeProfile(config, agent.id).agentPath));
    const found = results.filter((r) => r.found).length;
    logger.info('app', `System scan complete: ${found}/${AGENTS.length} agents detected`);
    return results;
  });

  ipcMain.handle(IPC.ScanAgent, (_e, agentId: string, explicitPath?: string): ScanResult => {
    return scanAgent(getAgent(agentId), ctx, explicitPath);
  });

  ipcMain.handle(IPC.HeadroomDetect, (): ScanResult => {
    const config = store!.load();
    const targetId = config.defaultCompressor || 'headroom';
    const proxyDef = getProxy(targetId);
    const configuredPath = targetId === 'headroom' ? config.headroomPath : undefined;
    return scanAgent(proxyToAgentDef(proxyDef), ctx, configuredPath);
  });

  ipcMain.handle(IPC.ProxyList, () => PROXIES.map((p) => serializeProxy(p)));

  ipcMain.handle(IPC.ProxyDetect, (_e, proxyId?: string, explicitPath?: string): ScanResult => {
    const config = store!.load();
    const targetId = proxyId || config.defaultCompressor || 'headroom';
    const proxyDef = getProxy(targetId);
    const configuredPath = explicitPath ?? (targetId === 'headroom' ? config.headroomPath : undefined);
    return scanAgent(proxyToAgentDef(proxyDef), ctx, configuredPath);
  });

  ipcMain.handle(IPC.InstallProxy, async (_e, proxyId: string, optionId?: string): Promise<{ ok: boolean; message: string; paths?: string[]; options?: ReturnType<typeof getProxyInstallOptions> }> => {
    const proxyDef = getProxy(proxyId);
    const options = getProxyInstallOptions(proxyId, ctx.platform);
    if (options.length === 0) {
      return { ok: false, message: `No automatic install command available for ${proxyDef.name}`, options };
    }

    const chosen = (optionId && options.find((o) => o.id === optionId)) || options[0];
    const cmd = chosen.command;
    logger.info('proxy', `Executing CLI installation for ${proxyDef.name} [${chosen.id}]: ${cmd}`);

    // Augment PATH so the installer's own tools (pip/uv/npm) and post-install
    // binaries are visible inside Electron's often-stripped environment.
    const baseEnv = { ...process.env } as Record<string, string>;
    const home = ctx.homeDir || process.env.HOME || process.env.USERPROFILE || '';
    baseEnv.PATH = mergePathWithUserBins(baseEnv.PATH ?? baseEnv.Path ?? '', ctx.platform, home);

    const runOne = (command: string): Promise<{ code: number | null; error?: string }> =>
      new Promise((resolve) => {
        const { shell, flag } = resolveInstallShell(ctx.platform);
        const child = nodeSpawn(shell, [flag, command], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: baseEnv,
        });
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) logger.info('proxy', `[${proxyDef.name} install] ${text}`);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) logger.warn('proxy', `[${proxyDef.name} install] ${text}`);
        });
        child.on('close', (code) => resolve({ code }));
        child.on('error', (err) => resolve({ code: 1, error: String(err) }));
      });

    // Preferred first; if the chosen option fails, walk the rest automatically.
    const queue = optionId
      ? [chosen, ...options.filter((o) => o.id !== chosen.id)]
      : options;
    let lastError: string | undefined;
    for (const opt of queue) {
      logger.info('proxy', `Trying install option "${opt.label}" for ${proxyDef.name}`);
      const result = await runOne(opt.command);
      lastError = result.error;
      if (result.code === 0) {
        // Refresh PATH and re-scan so the UI can locate the binary immediately.
        process.env.PATH = baseEnv.PATH;
        const probedDirs = splitPathEnv(baseEnv.PATH, ctx.platform);
        const proxyAgentDef = proxyToAgentDef(proxyDef);
        const scan = scanAgent(proxyAgentDef, { ...ctx, env: { ...ctx.env, PATH: baseEnv.PATH } });
        if (scan.found) {
          logger.info('proxy', `Successfully installed ${proxyDef.name}; found at ${scan.paths[0]}`);
          const outcome = formatInstallOutcome({
            ok: true,
            exitedZero: true,
            detected: true,
            probedDirs,
            label: opt.label,
            name: proxyDef.name,
          });
          return {
            ok: true,
            message: `${outcome.message} Found at ${scan.paths[0]}`,
            paths: scan.paths,
            options,
          };
        }
        logger.warn('proxy', `Install of ${proxyDef.name} via ${opt.label} exited 0 but binary not yet on PATH`);
        const outcome = formatInstallOutcome({
          ok: true,
          exitedZero: true,
          detected: false,
          probedDirs,
          label: opt.label,
          name: proxyDef.name,
        });
        return {
          ok: true,
          message: `${outcome.message} (via ${opt.label})`,
          paths: [],
          options,
        };
      }
      logger.warn('proxy', `Install option "${opt.label}" failed (exit ${result.code}${result.error ? `: ${result.error}` : ''})`);
    }

    const outcome = formatInstallOutcome({
      ok: false,
      exitedZero: false,
      detected: false,
      probedDirs: splitPathEnv(baseEnv.PATH, ctx.platform),
      label: queue.map((o) => o.label).join(', '),
      name: proxyDef.name,
      error: lastError,
    });
    return {
      ok: false,
      message: outcome.message,
      options,
    };
  });

  ipcMain.handle(IPC.InstallProxyOptions, (_e, proxyId: string) => {
    return getProxyInstallOptions(proxyId, ctx.platform);
  });

  ipcMain.handle(IPC.InstallAgentOptions, (_e, agentId: string) => {
    return getAgentInstallOptions(agentId, ctx.platform);
  });

  ipcMain.handle(IPC.InstallAgent, async (_e, agentId: string, optionId?: string): Promise<{ ok: boolean; message: string; paths?: string[]; options?: ReturnType<typeof getAgentInstallOptions> }> => {
    let agentDef: AgentDefinition;
    try {
      agentDef = getAgent(agentId);
    } catch {
      return { ok: false, message: `Unknown agent: ${agentId}` };
    }
    const options = getAgentInstallOptions(agentId, ctx.platform);
    if (options.length === 0) {
      return { ok: false, message: `No automatic install command for ${agentDef.name}`, options };
    }
    const chosen = (optionId && options.find((o) => o.id === optionId)) || options[0];
    logger.info('app', `Installing ${agentDef.name} [${chosen.id}]: ${chosen.command}`);

    const baseEnv = { ...process.env } as Record<string, string>;
    const home = ctx.homeDir || process.env.HOME || process.env.USERPROFILE || '';
    baseEnv.PATH = mergePathWithUserBins(baseEnv.PATH ?? baseEnv.Path ?? '', ctx.platform, home);

    const runOne = (command: string): Promise<{ code: number | null; error?: string }> =>
      new Promise((resolve) => {
        const { shell, flag } = resolveInstallShell(ctx.platform);
        const child = nodeSpawn(shell, [flag, command], { stdio: ['pipe', 'pipe', 'pipe'], env: baseEnv });
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) logger.info('app', `[${agentDef.name} install] ${text}`);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) logger.warn('app', `[${agentDef.name} install] ${text}`);
        });
        child.on('close', (code) => resolve({ code }));
        child.on('error', (err) => resolve({ code: 1, error: String(err) }));
      });

    const queue = optionId
      ? [chosen, ...options.filter((o) => o.id !== chosen.id)]
      : options;
    let lastError: string | undefined;
    for (const opt of queue) {
      logger.info('app', `Trying install option "${opt.label}" for ${agentDef.name}`);
      const result = await runOne(opt.command);
      lastError = result.error;
      if (result.code === 0) {
        process.env.PATH = baseEnv.PATH;
        const probedDirs = splitPathEnv(baseEnv.PATH, ctx.platform);
        const scan = scanAgent(agentDef, { ...ctx, env: { ...ctx.env, PATH: baseEnv.PATH } });
        if (scan.found) {
          const outcome = formatInstallOutcome({
            ok: true,
            exitedZero: true,
            detected: true,
            probedDirs,
            label: opt.label,
            name: agentDef.name,
          });
          return {
            ok: true,
            message: `${outcome.message} Found at ${scan.paths[0]}`,
            paths: scan.paths,
            options,
          };
        }
        const outcome = formatInstallOutcome({
          ok: true,
          exitedZero: true,
          detected: false,
          probedDirs,
          label: opt.label,
          name: agentDef.name,
        });
        return {
          ok: true,
          message: `${outcome.message} (via ${opt.label})`,
          paths: [],
          options,
        };
      }
      logger.warn('app', `Install option "${opt.label}" failed (exit ${result.code})`);
    }
    const outcome = formatInstallOutcome({
      ok: false,
      exitedZero: false,
      detected: false,
      probedDirs: splitPathEnv(baseEnv.PATH, ctx.platform),
      label: queue.map((o) => o.label).join(', '),
      name: agentDef.name,
      error: lastError,
    });
    return {
      ok: false,
      message: outcome.message,
      options,
    };
  });

  ipcMain.handle(IPC.ConfigGet, (): AppConfig => store!.load());

  ipcMain.handle(IPC.ConfigSave, (_e, config: AppConfig): { ok: boolean; error?: string } => {
    try {
      for (const agentCfg of config.agents) {
        for (const profile of agentCfg.profiles) {
          const errors = validateProfile(profile);
          if (errors.length > 0) {
            return { ok: false, error: `${agentCfg.agentId}/${profile.name}: ${errors.join('; ')}` };
          }
        }
      }
      store!.save(config);
      nativeTheme.themeSource = config.theme;
      logger.info('app', 'Configuration saved');
      return { ok: true };
    } catch (err) {
      logger.error('app', `Failed to save configuration: ${String(err)}`);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.PortCheck, (_e, port: number) => checkPortFree(port));
  ipcMain.handle(IPC.PortKill, async (_e, port: number) => {
    logger.warn('app', `Killing processes on port ${port}`);
    const result = await killPort(port);
    logger.info('app', `Port kill result: ${JSON.stringify(result)}`);
    return result;
  });

  /* ------------------------------ launching (launchId-keyed) --------------- */

  // Free-port allocator integrated with the launcher.
  const portAlloc = new PortAllocator({
    range: [8400, 8999],
  });

  ipcMain.handle(IPC.LaunchStart, async (_e, opts: { agentId: string; compressorId?: string }): Promise<unknown> => {
    const config = store!.load();
    const { agent, profile, profileErr } = resolveAgentForLaunch(config, opts.agentId);
    if (profileErr) {
      logger.error(opts.agentId, profileErr);
      throw new Error(profileErr);
    }

    const compressorId = opts.compressorId || config.defaultCompressor || 'headroom';
    const proxyDef = getProxyDef(config, compressorId);
    const proxyAgentDef = proxyToAgentDef(proxyDef);

    const proxyScan = scanAgent(proxyAgentDef, ctx, proxyProfilePath(config, compressorId) || (compressorId === 'headroom' ? config.headroomPath : undefined));
    if (proxyDef.mode === 'server' && !proxyScan.found && proxyDef.id !== 'custom') {
      const msg = `${proxyDef.name} binary not found. ${proxyDef.installInstructions ?? 'Install the proxy binary or set its path in Settings.'}`;
      logger.error('app', msg);
      throw new Error(msg);
    }

    const scan = scanAgent(agent, ctx, profile.agentPath);
    const agentBin = resolveAgentBinary(profile, scan);
    if (agent.launchStrategy === 'env' && !agentBin) {
      const msg = `${agent.name} executable not found. Scan the system or set an explicit path.`;
      logger.error(opts.agentId, msg);
      throw new Error(msg);
    }

    // Choose the launch port: the user's fixed port takes effect when
    // auto-assignment is disabled and the port is free; otherwise allocate.
    const choice = chooseLaunchPort(opts.agentId, {
      autoPort: profile.autoPort,
      requestedPort: profile.port,
      isReserved: (p) => portAlloc.isReserved(p),
      reserveFixed: (agentId, p) => portAlloc.reserve(agentId, p).port === p,
      allocateAuto: (id) => portAlloc.allocate(id),
    });
    const port = choice.port;
    const launchId = choice.id;

    const proxyBin = proxyScan.paths[0] || (proxyDef.executables[0] ?? compressorId);
    // Override profile port with the (chosen) launch port.
    const launchProfile = { ...profile, port };
    const plan = buildLaunchPlan(agent, launchProfile, proxyDef, proxyBin, agentBin);
    logger.info(launchId, `Launch plan: ${plan.headroomBin} ${plan.proxyArgs.join(' ')}`);
    const proxyFlags = {
      mode: profile.mode,
      memory: profile.memory,
      learn: profile.learn,
      lossless: profile.lossless,
      noOptimize: profile.noOptimize,
      extraArgs: profile.extraProxyArgs,
    };

    const lr = launches.start({
      agentId: opts.agentId,
      compressorId,
      profile: profile.name,
      cwd: profile.workingDirectory,
      command: `${proxyBin} ${plan.proxyArgs.join(' ')} ➜ ${plan.agentBin ?? agent.name} ${plan.agentArgs.join(' ')}`,
      env: plan.env,
      port,
    });
    // Map launchAllocation id to LaunchTracker id.
    launchByAlloc.set(choice.id, lr.id);
    send(IPC.EventOutput, lr);

    const runtime = await manager!.start(launchId, plan, proxyDef, proxyBin, proxyFlags, agent.name, config.proxyStartupTimeoutMs);
    launches.setState(lr.id, runtime.state);
    send(IPC.EventOutput, launches.get(lr.id));
    return { ...runtime, id: launchId };
  });


  /* ------------------------ embedded launch (workflow) ------------------- */

  ipcMain.handle(IPC.LaunchEmbedded, async (_e, opts: { agentId: string; compressorId?: string }): Promise<unknown> => {
    const config = store!.load();
    const { agent, profile, profileErr } = resolveAgentForLaunch(config, opts.agentId);
    if (profileErr) {
      logger.error(opts.agentId, profileErr);
      throw new Error(profileErr);
    }
    const compressorId = opts.compressorId || config.defaultCompressor || 'headroom';
    const proxyDef = getProxyDef(config, compressorId);
    const proxyAgentDef = proxyToAgentDef(proxyDef);
    const proxyScan = scanAgent(proxyAgentDef, ctx, proxyProfilePath(config, compressorId) || (compressorId === 'headroom' ? config.headroomPath : undefined));
    if (proxyDef.mode === 'server' && !proxyScan.found && proxyDef.id !== 'custom') {
      const msg = `${proxyDef.name} binary not found. ${proxyDef.installInstructions ?? 'Install the proxy binary.'}`;
      logger.error('app', msg);
      throw new Error(msg);
    }
    const scan = scanAgent(agent, ctx, profile.agentPath);
    const agentBin = resolveAgentBinary(profile, scan);
    if (agent.launchStrategy === 'env' && !agentBin) {
      const msg = `${agent.name} executable not found.`;
      logger.error(opts.agentId, msg);
      throw new Error(msg);
    }
    const choice = chooseLaunchPort(opts.agentId, {
      autoPort: profile.autoPort,
      requestedPort: profile.port,
      isReserved: (p) => portAlloc.isReserved(p),
      reserveFixed: (agentId, p) => portAlloc.reserve(agentId, p).port === p,
      allocateAuto: (id) => portAlloc.allocate(id),
    });
    const port = choice.port;
    const launchId = choice.id;
    const proxyBin = proxyScan.paths[0] || (proxyDef.executables[0] ?? compressorId);
    const launchProfile = { ...profile, port };
    const plan = buildLaunchPlan(agent, launchProfile, proxyDef, proxyBin, agentBin);
    logger.info(launchId, `Embedded launch: ${plan.headroomBin} ${plan.proxyArgs.join(' ')}`);
    const proxyFlags = {
      mode: profile.mode, memory: profile.memory, learn: profile.learn,
      lossless: profile.lossless, noOptimize: profile.noOptimize, extraArgs: profile.extraProxyArgs,
    };
    const lr = launches.start({
      agentId: opts.agentId, compressorId, profile: profile.name,
      cwd: profile.workingDirectory,
      command: `${proxyBin} ${plan.proxyArgs.join(' ')}  ${plan.agentBin ?? agent.name} ${plan.agentArgs.join(' ')}`,
      env: plan.env, port,
    });
    launchByAlloc.set(choice.id, lr.id);
    send(IPC.EventOutput, lr);
    const runtime = await manager!.start(launchId, plan, proxyDef, proxyBin, proxyFlags, agent.name, config.proxyStartupTimeoutMs, true);
    launches.setState(lr.id, runtime.state);
    const record = launches.get(lr.id);
    send(IPC.EventOutput, record);
    // Include tracker output so the Workflow UI can hydrate spawn/PTY lines that
    // arrived before the renderer created its session object.
    return {
      ...runtime,
      id: launchId,
      trackerId: lr.id,
      output: record?.output ?? [],
    };
  });

  ipcMain.handle(IPC.LaunchStop, async (_e, launchId: string) => {
    logger.info(launchId, 'Stop requested');
    const trackerId = launchByAlloc.get(launchId) || launchId;
    if (trackerId) launches.stop(trackerId);
    portAlloc.release(launchId);
    return manager!.stop(launchId);
  });

  ipcMain.handle(IPC.RuntimeAll, () => manager!.allRuntimes());

  /* ------------------------- stdin input (workflow) --------------------- */

  ipcMain.handle(IPC.ProcessInput, (_e, launchId: string, text: string, raw?: boolean): boolean => {
    if (raw) return manager?.writeStdinRaw(launchId, text) ?? false;
    return manager?.writeStdin(launchId, text) ?? false;
  });

  manager!.onTerminalData((launchId, data) => {
    send(IPC.EventTerminalData, { launchId, data });
  });

  /* --------------------------- compatibility ---------------------------- */

  ipcMain.handle(IPC.CompatibilityGet, () => {
    const config = store!.load();
    const compressors = getAllCompressors(config);
    return compressors.map((c) => ({
      id: c.id,
      name: c.name,
      mode: ('mode' in c ? c.mode : 'server'),
      envStyle: ('envStyle' in c ? c.envStyle : 'both'),
      agentIds: compatibleAgentIds(c.id, 'mode' in c ? c : undefined, AGENTS),
    }));
  });

  ipcMain.handle(IPC.CompatibleAgents, (_e, compressorId: string): string[] => {
    const config = store!.load();
    const comp = getAllCompressors(config).find((c) => c.id === compressorId);
    const def = comp && 'mode' in comp ? comp : { id: compressorId, mode: 'server' as const, envStyle: 'both' as const };
    return compatibleAgentIds(compressorId, def, AGENTS);
  });

  /* --------------------------- custom entries --------------------------- */

  ipcMain.handle(IPC.CustomAgentSave, (_e, input: CustomAgent): { ok: boolean; error?: string; agent?: CustomAgent } => {
    const config = store!.load();
    const existing = config.customAgents;
    const merged: CustomAgent = { ...defaultCustomAgent(input.name, existing), ...input };
    const errors = validateCustomAgent(merged);
    if (errors.length > 0) return { ok: false, error: errors.join('; ') };
    const idx = existing.findIndex((c) => c.id === merged.id);
    if (idx >= 0) existing[idx] = merged;
    else existing.push(merged);
    config.customAgents = existing;
    store!.save(config);
    logger.info('app', `Custom agent "${merged.name}" saved`);
    return { ok: true, agent: merged };
  });

  ipcMain.handle(IPC.CustomAgentDelete, (_e, id: string): { ok: boolean } => {
    const config = store!.load();
    config.customAgents = config.customAgents.filter((c) => c.id !== id);
    store!.save(config);
    logger.info('app', `Custom agent deleted (${id})`);
    return { ok: true };
  });

  ipcMain.handle(IPC.CustomProxySave, (_e, input: CustomProxy): { ok: boolean; error?: string; proxy?: CustomProxy } => {
    const config = store!.load();
    const existing = config.customProxies;
    const merged: CustomProxy = { ...defaultCustomProxy(input.name, existing), ...input };
    const errors = validateCustomProxy(merged);
    if (errors.length > 0) return { ok: false, error: errors.join('; ') };
    const idx = existing.findIndex((c) => c.id === merged.id);
    if (idx >= 0) existing[idx] = merged;
    else existing.push(merged);
    config.customProxies = existing;
    store!.save(config);
    logger.info('app', `Custom compressor "${merged.name}" saved`);
    return { ok: true, proxy: merged };
  });

  ipcMain.handle(IPC.CustomProxyDelete, (_e, id: string): { ok: boolean } => {
    const config = store!.load();
    config.customProxies = config.customProxies.filter((c) => c.id !== id);
    if (config.defaultCompressor === id) config.defaultCompressor = 'headroom';
    store!.save(config);
    logger.info('app', `Custom compressor deleted (${id})`);
    return { ok: true };
  });

  ipcMain.handle(IPC.LaunchesList, () => launches.list());

  /* -------------------------------- logs -------------------------------- */

  ipcMain.handle(IPC.LogsList, () => logger.list());
  ipcMain.handle(IPC.LogsClear, () => logger.clear());

  /* ------------------------------- dialogs ------------------------------ */

  ipcMain.handle(IPC.PickExecutable, async (): Promise<string | null> => {
    const win = getWindow();
    if (!win) return null;
    const filters =
      ctx.platform === 'win32'
        ? [
            { name: 'Executables', extensions: ['exe', 'cmd', 'bat'] },
            { name: 'All Files', extensions: ['*'] },
          ]
        : [{ name: 'All Files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.PickDirectory, async (): Promise<string | null> => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.OpenPath, async (_e, target: string) => {
    try {
      const expanded = target.replace(/^~/, app.getPath('home'));
      if (fs.existsSync(expanded)) {
        shell.showItemInFolder(expanded);
      } else {
        const dir = path.dirname(expanded);
        if (fs.existsSync(dir)) shell.showItemInFolder(dir);
        else await shell.openPath(app.getPath('home'));
      }
    } catch (err) {
      logger.warn('app', `Could not open path ${target}: ${String(err)}`);
    }
  });

  ipcMain.handle(IPC.OpenUrl, async (_e, targetUrl: string) => {
    try {
      await shell.openExternal(targetUrl);
    } catch (err) {
      logger.warn('app', `Failed to open URL "${targetUrl}": ${String(err)}`);
    }
  });
}

/** Current persisted configuration (main-process use only). */
export function currentConfig(): AppConfig | null {
  try {
    return store?.load() ?? null;
  } catch {
    return null;
  }
}

/** Kill every managed process (app shutdown). */
export function Shutdown(): void {
  try {
    manager?.stopAll();
  } catch {
    /* best effort */
  }
}

export type { IPCTypes };
