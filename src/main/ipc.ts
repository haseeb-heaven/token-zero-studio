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
import { scanAgent } from '../core/scanner';
import type { AgentDefinition, AppConfig, IPC as IPCTypes, ScanResult } from '../shared/types';
import { IPC } from '../shared/types';

const logger = new Logger(3000);
let manager: ProcessManager | null = null;
let store: ConfigStore | null = null;

/** Pseudo-agent used to auto-detect the headroom binary itself. */
const HEADROOM_AGENT: AgentDefinition = {
  id: 'headroom',
  name: 'Headroom',
  vendor: 'Headroom',
  description: 'Headroom CLI',
  interfaceType: 'cli',
  launchStrategy: 'env',
  executables: ['headroom'],
  wellKnownPaths: {
    win32: ['~\\AppData\\Roaming\\Python\\Scripts\\headroom.exe', '~\\.local\\bin\\headroom.exe'],
    darwin: ['/usr/local/bin/headroom', '/opt/homebrew/bin/headroom', '~/.local/bin/headroom'],
    linux: ['/usr/local/bin/headroom', '~/.local/bin/headroom', '/usr/bin/headroom'],
  },
  envStyle: 'none',
  defaultArgs: [],
  configFileHint: '',
  defaultPort: 8787,
  accent: '#38bdf8',
  homepage: 'https://github.com',
};

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

async function realFetch(url: string): Promise<{ status: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  return { status: res.status };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const ctx = platformCtx();
  store = new ConfigStore(path.join(app.getPath('userData'), 'config.json'), fs);
  manager = new ProcessManager({
    spawn: realSpawn,
    fetch: realFetch,
    logger,
    platform: ctx.platform,
    terminal: detectTerminal(ctx),
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
    const configured = store!.load().headroomPath;
    return scanAgent(HEADROOM_AGENT, ctx, configured);
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

  /* ------------------------------ launching ----------------------------- */

  ipcMain.handle(IPC.LaunchStart, async (_e, agentId: string): Promise<unknown> => {
    const agent = getAgent(agentId);
    const config = store!.load();
    const profile = activeProfile(config, agentId);

    const headroomScan = scanAgent(HEADROOM_AGENT, ctx, config.headroomPath);
    if (!headroomScan.found) {
      const msg = 'Headroom binary not found. Install headroom-ai (pip install headroom-ai) or set its path in Settings.';
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

    const plan = buildLaunchPlan(agent, profile, headroomScan.paths[0], agentBin);
    logger.info(agentId, `Launch plan: ${plan.headroomBin} ${plan.proxyArgs.join(' ')}`);
    return manager!.start(plan, agent.name, config.proxyStartupTimeoutMs);
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
