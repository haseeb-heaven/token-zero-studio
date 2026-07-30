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
 * Owns the lifecycle of proxy processes, keyed by agentId.
 *
 * For 'server' mode proxies (Headroom, PxPipe, Custom) this spawns the binary
 * and waits for it to answer HTTP. For 'wrapper' mode proxies (RTK) there is
 * nothing to spawn — the runtime simply reports 'up'.
 */
export class ProxyManager {
  private entries = new Map<string, RunningProxy>();
  private listeners = new Set<(agentId: string, runtime: ProxyRuntime) => void>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ProxyManagerDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
  }

  onRuntimeChange(listener: (agentId: string, runtime: ProxyRuntime) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runtimeFor(agentId: string): ProxyRuntime {
    return { ...(this.entries.get(agentId)?.runtime ?? { proxyId: agentId, state: 'stopped' }) };
  }

  /**
   * Start the proxy for a given agent. For wrapper-mode proxies (RTK) this
   * resolves immediately with state 'up' since no server is started.
   */
  async start(
    agentId: string,
    definition: ProxyDefinition,
    binary: string,
    port: number,
    flags: ProxyFlags,
    startupTimeoutMs: number,
  ): Promise<ProxyRuntime> {
    const existing = this.entries.get(agentId);
    if (existing && existing.runtime.state !== 'stopped' && existing.runtime.state !== 'error') {
      throw new Error(`Proxy for ${agentId} is already ${existing.runtime.state}`);
    }

    // Wrapper mode (e.g. RTK) — no server to start.
    if (definition.mode === 'wrapper') {
      const entry: RunningProxy = {
        runtime: { proxyId: definition.id, state: 'up', port: 0 },
      };
      this.entries.set(agentId, entry);
      this.emit(agentId, entry);
      this.deps.logger.info('proxy', `${definition.name} initialised (wrapper mode)`);
      return { ...entry.runtime };
    }

    const entry: RunningProxy = {
      runtime: { proxyId: definition.id, state: 'starting', port },
    };
    this.entries.set(agentId, entry);
    this.emit(agentId, entry);

    const args = definition.buildStartArgs(port, flags as Parameters<typeof definition.buildStartArgs>[1]);

    try {
      entry.proc = this.deps.spawn(binary, args, {
        env: {},
        cwd: process.cwd(),
        detached: true,
      });
    } catch (err) {
      return this.fail(agentId, entry, `Failed to start ${definition.name} proxy: ${String(err)}`);
    }

    entry.runtime.pid = entry.proc.pid;
    this.pipeLogs(entry.proc, definition.name, agentId);
    entry.proc.on('exit', (code) => {
      this.deps.logger.warn('proxy', `${definition.name} proxy for ${agentId} exited (code ${String(code)})`);
      const s = entry.runtime.state;
      if (s !== 'stopping' && s !== 'stopped' && s !== 'error') {
        entry.runtime.state = 'stopped';
        entry.runtime.pid = undefined;
        this.emit(agentId, entry);
      }
    });
    entry.proc.on('error', (err) => {
      void this.fail(agentId, entry, `${definition.name} proxy error: ${String(err)}`);
    });

    const ready = await waitForProxyReady(port, startupTimeoutMs, this.deps.fetch, this.sleep);
    if (!ready) {
      return this.fail(agentId, entry, `${definition.name} proxy did not become ready on port ${port} within ${startupTimeoutMs}ms`);
    }

    entry.runtime.state = 'up';
    this.emit(agentId, entry);
    this.deps.logger.info('proxy', `${definition.name} proxy ready on http://127.0.0.1:${port}`);
    return { ...entry.runtime };
  }

  stop(agentId: string): ProxyRuntime {
    const entry = this.entries.get(agentId);
    if (!entry || entry.runtime.state === 'stopped') {
      return { proxyId: agentId, state: 'stopped' };
    }
    entry.runtime.state = 'stopping';
    this.emit(agentId, entry);
    try {
      entry.proc?.kill();
    } catch {
      /* already gone */
    }
    entry.runtime = { proxyId: entry.runtime.proxyId, state: 'stopped' };
    this.entries.set(agentId, entry);
    this.emit(agentId, entry);
    return { ...entry.runtime };
  }

  stopAll(): void {
    for (const agentId of this.entries.keys()) {
      this.stop(agentId);
    }
  }

  private pipeLogs(proc: ProxySpawnedProcess, proxyName: string, agentId: string): void {
    const onData = (level: 'info' | 'warn') => (chunk: Buffer) => {
      const text = chunk.toString('utf8').replace(/\s+$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          this.deps.logger.log(level, 'proxy', `[${proxyName}/${agentId}] ${line}`);
        }
      }
    };
    proc.stdout?.on('data', onData('info'));
    proc.stderr?.on('data', onData('warn'));
  }

  private fail(agentId: string, entry: RunningProxy, message: string): ProxyRuntime {
    this.deps.logger.error('proxy', message);
    try {
      entry.proc?.kill();
    } catch {
      /* ignore */
    }
    entry.runtime = { ...entry.runtime, state: 'error', error: message };
    this.entries.set(agentId, entry);
    this.emit(agentId, entry);
    throw new Error(message);
  }

  private emit(agentId: string, entry: RunningProxy): void {
    const snapshot = { ...entry.runtime };
    for (const listener of this.listeners) {
      try {
        listener(agentId, snapshot);
      } catch {
        /* listener errors must not break the manager */
      }
    }
  }
}
