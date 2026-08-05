import type { LaunchRecord, RunState } from '../shared/types';

/** Required fields to open a new launch/tab record. */
export interface LaunchRecordInit {
  agentId: string;
  compressorId: string;
  profile: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  port: number;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `launch-${Date.now().toString(36)}-${counter}`;
}

/**
 * Map a ProcessManager allocation id (e.g. `codex-1`) to the LaunchTracker
 * record id. Runtime/state updates must use the tracker id — looking up by
 * alloc id is a silent no-op.
 */
export function resolveTrackerId(
  allocToTracker: Map<string, string>,
  allocId: string | undefined | null,
): string | undefined {
  if (!allocId) return undefined;
  return allocToTracker.get(allocId);
}

/**
 * Prefer live tracker output (spawn logs, PTY frames) over a UI placeholder
 * when hydrating a Workflow session after launchEmbedded returns.
 */
export function mergeWorkflowOutput(
  placeholder: string[],
  trackerOutput: string[] | undefined,
): string[] {
  if (trackerOutput && trackerOutput.length > 0) return [...trackerOutput];
  return [...placeholder];
}

/**
 * Framework-free, in-memory tracker of launch records — one per launched agent
 * tab. Maintains a ring-buffer of history and a per-record output ring-buffer so
 * the tabbed UI can show live output and launch history without touching
 * Electron. Fully unit-testable.
 */
export class LaunchTracker {
  private records: LaunchRecord[] = [];
  private byId = new Map<string, LaunchRecord>();

  constructor(
    private readonly maxRecords = 100,
    private readonly maxOutput = 1000,
  ) {}

  /** Open a new launch record in 'starting' state. */
  start(init: LaunchRecordInit): LaunchRecord {
    const record: LaunchRecord = {
      id: nextId(),
      agentId: init.agentId,
      compressorId: init.compressorId,
      profile: init.profile,
      cwd: init.cwd ?? '',
      command: init.command ?? '',
      env: { ...(init.env ?? {}) },
      port: init.port ?? 0,
      state: 'starting',
      startedAt: Date.now(),
      output: [],
    };
    this.records.push(record);
    this.byId.set(record.id, record);
    if (this.records.length > this.maxRecords) {
      const removed = this.records.splice(0, this.records.length - this.maxRecords);
      for (const r of removed) this.byId.delete(r.id);
    }
    return { ...record, env: { ...record.env }, output: [...record.output] };
  }

  /** Update the run state of a record. */
  setState(id: string, state: RunState, stoppedAt?: number): LaunchRecord | undefined {
    const r = this.byId.get(id);
    if (!r) return undefined;
    r.state = state;
    if (stoppedAt !== undefined) r.stoppedAt = stoppedAt;
    if (state === 'stopped') r.stoppedAt = r.stoppedAt ?? Date.now();
    return { ...r, env: { ...r.env }, output: [...r.output] };
  }

  /** Append lines of output to a record's ring-buffer. */
  appendOutput(id: string, text: string): void {
    const r = this.byId.get(id);
    if (!r) return;
    for (const line of text.split(/\r?\n/)) {
      const t = line.replace(/\s+$/, '');
      if (!t) continue;
      r.output.push(t);
    }
    if (r.output.length > this.maxOutput) {
      r.output.splice(0, r.output.length - this.maxOutput);
    }
  }

  /** Mark a record stopped. */
  stop(id: string): LaunchRecord | undefined {
    return this.setState(id, 'stopped', Date.now());
  }

  /** All records, newest first. */
  list(): LaunchRecord[] {
    return [...this.records].reverse().map((r) => ({ ...r, env: { ...r.env }, output: [...r.output] }));
  }

  /** A single record, or undefined. */
  get(id: string): LaunchRecord | undefined {
    const r = this.byId.get(id);
    return r ? { ...r, env: { ...r.env }, output: [...r.output] } : undefined;
  }

  clear(): void {
    this.records = [];
    this.byId.clear();
  }

  get size(): number {
    return this.records.length;
  }
}
