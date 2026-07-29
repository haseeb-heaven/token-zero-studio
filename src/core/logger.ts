import type { LogEntry, LogLevel } from '../shared/types';

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * In-memory ring-buffer log with subscription support. The Electron main
 * process forwards entries to the renderer; tests can assert on `list()`.
 */
export class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(private readonly maxEntries = 2000) {
    if (maxEntries < 1) throw new Error('maxEntries must be >= 1');
  }

  log(level: LogLevel, source: string, message: string): LogEntry {
    const entry: LogEntry = { timestamp: Date.now(), level, source, message };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        /* a broken listener must never break logging */
      }
    }
    return entry;
  }

  debug(source: string, message: string): LogEntry {
    return this.log('debug', source, message);
  }
  info(source: string, message: string): LogEntry {
    return this.log('info', source, message);
  }
  warn(source: string, message: string): LogEntry {
    return this.log('warn', source, message);
  }
  error(source: string, message: string): LogEntry {
    return this.log('error', source, message);
  }

  /** Snapshot of current entries, oldest first. */
  list(): LogEntry[] {
    return [...this.entries];
  }

  /** Subscribe to new entries; returns an unsubscribe function. */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}
