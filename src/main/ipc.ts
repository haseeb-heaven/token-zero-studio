import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { AGENTS, getAgent } from '../core/agents';
import { ConfigStore, activeProfile, validateProfile } from '../core/config';
import { ProcessManager, SpawnedProcess, buildLaunchPlan, resolveAgentBinary } from '../core/launcher';
import { Logger } from '../core/logger';
import { currentPlatformContext } from '../core/platform';
import { ProxyManager } from '../core/proxy-manager';
import { PROXIES, getProxy } from '../core/proxies/registry';
import type { ProxyDefinition } from '../core/proxies/types';
import { scanAgent } from '../core/scanner';
import type { AgentDefinition, AppConfig, IPC as IPCTypes, ScanResult } from '../shared/types';
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
  const child = nodeSpawn(cmd, args, {
    env: { ...process.env, ...opts.env },
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
  manager.onRuntimeChange((runtime) => send(IPC.EventRuntime, runtime));

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
    const targetId = config.activeProxy || 'headroom';
    const proxyDef = getProxy(targetId);
    const configuredPath = targetId === 'headroom' ? config.headroomPath : undefined;
    return scanAgent(proxyToAgentDef(proxyDef), ctx, configuredPath);
  });

  ipcMain.handle(IPC.ProxyList, () => PROXIES);

  ipcMain.handle(IPC.ProxyDetect, (_e, proxyId?: string, explicitPath?: string): ScanResult => {
    const config = store!.load();
    const targetId = proxyId || config.activeProxy || 'headroom';
    const proxyDef = getProxy(targetId);
    const configuredPath = explicitPath ?? (targetId === 'headroom' ? config.headroomPath : undefined);
    return scanAgent(proxyToAgentDef(proxyDef), ctx, configuredPath);
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

  /* ------------------------------ launching ----------------------------- */

  ipcMain.handle(IPC.LaunchStart, async (_e, agentId: string): Promise<unknown> => {
    const agent = getAgent(agentId);
    const config = store!.load();
    const profile = activeProfile(config, agentId);

    const activeProxyId = config.activeProxy || 'headroom';
    const proxyDef = getProxy(activeProxyId);
    const proxyAgentDef = proxyToAgentDef(proxyDef);

    const proxyScan = scanAgent(proxyAgentDef, ctx, activeProxyId === 'headroom' ? config.headroomPath : undefined);
    if (proxyDef.mode === 'server' && !proxyScan.found && proxyDef.id !== 'custom') {
      const msg = `${proxyDef.name} binary not found. ${proxyDef.installInstructions ?? 'Install the proxy binary or set its path in Settings.'}`;
      logger.error('app', msg);
      throw new Error(msg);
    }

    const scan = scanAgent(agent, ctx, profile.agentPath);
    const agentBin = resolveAgentBinary(profile, scan);
    if (agent.launchStrategy === 'env' && !agentBin) {
      const msg = `${agent.name} executable not found. Scan the system or set an explicit path.`;
      logger.error(agentId, msg);
      throw new Error(msg);
    }

    if (!(await checkPortFree(profile.port))) {
      const existing = manager!.runtimeFor(agentId);
      const ownProxy = existing.state === 'proxy-up' || existing.state === 'running';
      if (!ownProxy) {
        const msg = `Port ${profile.port} is already in use. Pick another port in the profile.`;
        logger.error(agentId, msg);
        throw new Error(msg);
      }
    }

    const proxyBin = proxyScan.paths[0] || (proxyDef.executables[0] ?? activeProxyId);
    const plan = buildLaunchPlan(agent, profile, proxyDef, proxyBin, agentBin);
    logger.info(agentId, `Launch plan: ${plan.headroomBin} ${plan.proxyArgs.join(' ')}`);
    const proxyFlags = {
      mode: profile.mode,
      memory: profile.memory,
      learn: profile.learn,
      lossless: profile.lossless,
      noOptimize: profile.noOptimize,
      extraArgs: profile.extraProxyArgs,
    };
    return manager!.start(plan, proxyDef, proxyBin, proxyFlags, agent.name, config.proxyStartupTimeoutMs);
  });

  ipcMain.handle(IPC.LaunchStop, (_e, agentId: string) => {
    logger.info(agentId, 'Stop requested');
    return manager!.stop(agentId);
  });

  ipcMain.handle(IPC.RuntimeAll, () => manager!.allRuntimes());

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
