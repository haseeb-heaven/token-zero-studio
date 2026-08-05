import type { ProxyDefinition, ProxyFlags } from './proxies/types';
import type { Logger } from './logger';
import type { PlatformName } from '../shared/types';

export interface ProxySpawnedProcess {
  pid?: number;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'exit' | 'error', cb: (...args: unknown[]) => void): void;
  kill(signal?: string): void;
}

export type ProxySpawnFn = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd: string; detached?: boolean },
) => ProxySpawnedProcess;

export type ProxyFetchFn = (url: string) => Promise<{ status: number }>;

export interface ProxyManagerDeps {
  spawn: ProxySpawnFn;
  fetch: ProxyFetchFn;
  sleep?: (ms: number) => Promise<void>;
  logger: Logger;
  platform: PlatformName;
}

export type ProxyRunState = 'stopped' | 'starting' | 'up' | 'stopping' | 'error';

export interface ProxyRuntime {
  proxyId: string;
  state: ProxyRunState;
  port?: number;
  pid?: number;
  error?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll the proxy until it answers HTTP (any status) or the timeout elapses. */
export async function waitForProxyReady(
  port: number,
  timeoutMs: number,
  fetchImpl: ProxyFetchFn,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const urls = [
    `http://127.0.0.1:${port}/livez`,
    `http://127.0.0.1:${port}/healthz`,
    `http://127.0.0.1:${port}/health`,
    `http://127.0.0.1:${port}/v1/models`,
    `http://127.0.0.1:${port}/`,
  ];
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        await fetchImpl(url);
        return true;
      } catch {
        /* connection refused - keep polling */
      }
    }
    await sleep(intervalMs);
  }
  return false;
}

interface RunningProxy {
  runtime: ProxyRuntime;
  proc?: ProxySpawnedProcess;
}

/**
 * Owns the lifecycle of proxy processes, keyed by launchId.
 *
 * For 'server' mode proxies (Headroom, PxPipe, Custom) this spawns the binary
 * and waits for it to answer HTTP. For 'wrapper' mode proxies (RTK) there is
 * nothing to spawn — the runtime simply reports 'up'.
 */
export class ProxyManager {
  private entries = new Map<string, RunningProxy>();
  private listeners = new Set<(launchId: string, runtime: ProxyRuntime) => void>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ProxyManagerDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
  }

  onRuntimeChange(listener: (launchId: string, runtime: ProxyRuntime) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runtimeFor(launchId: string): ProxyRuntime {
    return { ...(this.entries.get(launchId)?.runtime ?? { proxyId: launchId, state: 'stopped' }) };
  }

  /**
   * Start the proxy for a given launch. For wrapper-mode proxies (RTK) this
   * resolves immediately with state 'up' since no server is started.
   */
  async start(
    launchId: string,
    definition: ProxyDefinition,
    binary: string,
    port: number,
    flags: ProxyFlags,
    startupTimeoutMs: number,
  ): Promise<ProxyRuntime> {
    const existing = this.entries.get(launchId);
    if (existing && existing.runtime.state !== 'stopped' && existing.runtime.state !== 'error') {
      throw new Error(`Proxy for ${launchId} is already ${existing.runtime.state}`);
    }

    // Wrapper mode (e.g. RTK) — no server to start.
    if (definition.mode === 'wrapper') {
      const entry: RunningProxy = {
        runtime: { proxyId: definition.id, state: 'up', port: 0 },
      };
      this.entries.set(launchId, entry);
      this.emit(launchId, entry);
      this.deps.logger.info('proxy', `${definition.name} initialised (wrapper mode)`);
      return { ...entry.runtime };
    }

    const entry: RunningProxy = {
      runtime: { proxyId: definition.id, state: 'starting', port },
    };
    this.entries.set(launchId, entry);
    this.emit(launchId, entry);

    const args = definition.buildStartArgs(port, flags as Parameters<typeof definition.buildStartArgs>[1]);

    try {
      entry.proc = this.deps.spawn(binary, args, {
        env: {},
        cwd: process.cwd(),
        detached: true,
      });
    } catch (err) {
      return this.fail(launchId, entry, `Failed to start ${definition.name} proxy: ${String(err)}`);
    }

    entry.runtime.pid = entry.proc.pid;
    this.pipeLogs(entry.proc, definition.name, launchId);
    entry.proc.on('exit', (code) => {
      this.deps.logger.warn('proxy', `${definition.name} proxy for ${launchId} exited (code ${String(code)})`);
      const s = entry.runtime.state;
      if (s !== 'stopping' && s !== 'stopped' && s !== 'error') {
        entry.runtime.state = 'stopped';
        entry.runtime.pid = undefined;
        this.emit(launchId, entry);
      }
    });
    entry.proc.on('error', (err) => {
      void this.fail(launchId, entry, `${definition.name} proxy error: ${String(err)}`);
    });

    const ready = await waitForProxyReady(port, startupTimeoutMs, this.deps.fetch, this.sleep);
    if (!ready) {
      return this.fail(launchId, entry, `${definition.name} proxy did not become ready on port ${port} within ${startupTimeoutMs}ms`);
    }

    entry.runtime.state = 'up';
    this.emit(launchId, entry);
    this.deps.logger.info('proxy', `${definition.name} proxy ready on http://127.0.0.1:${port}`);
    return { ...entry.runtime };
  }

  stop(launchId: string): ProxyRuntime {
    const entry = this.entries.get(launchId);
    if (!entry || entry.runtime.state === 'stopped') {
      return { proxyId: launchId, state: 'stopped' };
    }
    entry.runtime.state = 'stopping';
    this.emit(launchId, entry);
    try {
      entry.proc?.kill();
    } catch {
      /* already gone */
    }
    entry.runtime = { proxyId: entry.runtime.proxyId, state: 'stopped' };
    this.entries.set(launchId, entry);
    this.emit(launchId, entry);
    return { ...entry.runtime };
  }

  stopAll(): void {
    for (const launchId of this.entries.keys()) {
      this.stop(launchId);
    }
  }

  private pipeLogs(proc: ProxySpawnedProcess, proxyName: string, launchId: string): void {
    const onData = (level: 'info' | 'warn') => (chunk: Buffer) => {
      try {
        const text = chunk.toString('utf8').replace(/\s+$/, '');
        for (const line of text.split(/\r?\n/)) {
          if (line.trim().length > 0) {
            this.deps.logger.log(level, 'proxy', `[${proxyName}/${launchId}] ${line}`);
          }
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

  private fail(launchId: string, entry: RunningProxy, message: string): ProxyRuntime {
    this.deps.logger.error('proxy', message);
    try {
      entry.proc?.kill();
    } catch {
      /* ignore */
    }
    entry.runtime = { ...entry.runtime, state: 'error', error: message };
    this.entries.set(launchId, entry);
    this.emit(launchId, entry);
    throw new Error(message);
  }

  private emit(launchId: string, entry: RunningProxy): void {
    const snapshot = { ...entry.runtime };
    for (const listener of this.listeners) {
      try {
        listener(launchId, snapshot);
      } catch {
        /* listener errors must not break the manager */
      }
    }
  }
}