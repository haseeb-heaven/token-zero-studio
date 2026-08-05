/**
 * Free-port allocator for multi-instance agent launches.
 *
 * Each launch (identified by a launchId) needs a unique TCP port so multiple
 * tabs of the same agent can run concurrently. This allocator:
 *
 * 1. Maintains an in-memory pool of reserved ports scoped by allocation id.
 * 2. Checks with an external `portChecker` (async predicate) so the caller can
 *    reject ports already bound by non-managed processes.
 * 3. Releases ports back to the pool when the launch stops.
 */

export interface PortAllocation {
  /** A caller-chosen key (typically agentId + some suffix). */
  id: string;
  /** The allocated port. */
  port: number;
  /** Release this port back to the pool. Idempotent. */
  release: () => void;
}

export interface PortAllocatorOptions {
  /** Port range, inclusive. Default 8400-8999 (avoids agent defaults). */
  range?: [number, number];
}

interface Slot {
  id: string;
  port: number;
}

/** Default port range — wide enough for many concurrent launches. */
export const PORT_ALLOCATOR_RANGE: [number, number] = [8400, 8999];

/** Maximum attempts to find a free port before giving up. */
export const PORT_ALLOCATOR_MAX_TRIES = 200;

export class PortAllocator {
  private readonly range: [number, number];
  private slots = new Map<string, Slot>();
  private freePorts: number[] = [];

  constructor(opts?: PortAllocatorOptions) {
    this.range = opts?.range ?? PORT_ALLOCATOR_RANGE;
    // Pre-fill the free pool.
    for (let p = this.range[0]; p <= this.range[1]; p++) {
      this.freePorts.push(p);
    }
  }

  /**
   * Allocate a free port for `id`. Returns the port and a release function.
   * Throws when no ports are available (all allocated or all in-use).
   */
  allocate(agentId: string): PortAllocation {
    const counter = this.nextCounter(agentId);
    const id = `${agentId}-${counter}`;

    const reserved = this.reservedPorts();
    let tried = 0;

    for (const port of this.freePorts) {
      if (reserved.has(port)) continue;
      if (tried >= PORT_ALLOCATOR_MAX_TRIES) break;
      tried++;
      this.markReserved(port);
      const slot: Slot = { id, port };
      this.slots.set(id, slot);
      return {
        id,
        port,
        release: () => this.release(id),
      };
    }

    throw new Error(
      `No free ports available in range ${this.range[0]}-${this.range[1]} after ${tried} tries`,
    );
  }

  /** Release a port by slot id. Idempotent. */
  release(id: string): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    this.slots.delete(id);
    const port = slot.port;
    const idx = this.freePorts.findIndex((p) => p > port);
    if (idx >= 0) this.freePorts.splice(idx, 0, port);
    else this.freePorts.push(port);
  }

  /** Return all active allocations. */
  getAllocations(): Array<{ id: string; agentId: string; port: number }> {
    return [...this.slots.values()].map((s) => {
      const dashIdx = s.id.lastIndexOf('-');
      const agentId = dashIdx > 0 ? s.id.slice(0, dashIdx) : s.id;
      return { id: s.id, agentId, port: s.port };
    });
  }

  /** How many slots are currently allocated. */
  get allocatedCount(): number {
    return this.slots.size;
  }

  /** True when `port` is currently reserved (in use by a live allocation). */
  isReserved(port: number): boolean {
    return this.reservedPorts().has(port);
  }

  /**
   * Reserve a specific fixed `port` under a fixed id (`${agentId}-fixed`).
   * If the port is already reserved, falls back to a fresh auto allocation so
   * a manual port never collides with a running instance.
   */
  reserve(agentId: string, port: number): PortAllocation {
    const id = `${agentId}-fixed`;
    if (this.isReserved(port)) return this.allocate(agentId);
    this.markReserved(port);
    const slot: Slot = { id, port };
    this.slots.set(id, slot);
    return { id, port, release: () => this.release(id) };
  }

  // -- private helpers --

  private nextCounter(agentId: string): number {
    let max = 0;
    for (const key of this.slots.keys()) {
      if (key.startsWith(agentId + '-')) {
        const suffix = key.slice(agentId.length + 1);
        const n = parseInt(suffix, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max + 1;
  }

  private reservedPorts(): Set<number> {
    return new Set([...this.slots.values()].map((s) => s.port));
  }

  private markReserved(port: number): void {
    const idx = this.freePorts.indexOf(port);
    if (idx >= 0) this.freePorts.splice(idx, 1);
  }
}

/** Decision inputs for choosing the port a launch should use. */
export interface LaunchPortChoiceInput {
  /** When false, prefer the user's fixed `requestedPort`. */
  autoPort: boolean;
  /** The port the user configured / typed into the form. */
  requestedPort: number;
  /** True when `requestedPort` is already reserved by a live launch. */
  isReserved: (port: number) => boolean;
  /** Reserve the fixed port under `${agentId}-fixed`; returns false if it could not be reserved. */
  reserveFixed: (agentId: string, port: number) => boolean;
  /** Allocate a fresh free port (used when auto or when the fixed port is busy). */
  allocateAuto: (agentId: string) => PortAllocation;
}

/** Result of {@link chooseLaunchPort}. */
export interface LaunchPortChoice {
  port: number;
  /** Key used as the launch/runtime id. */
  id: string;
  /** True when the user's fixed `requestedPort` was used. */
  fixed: boolean;
  /** Release handle — only set for auto-allocated ports. */
  release?: () => void;
}

/**
 * Choose the port for a launch.
 *
 * When the user has disabled auto-assignment (`autoPort === false`) and their
 * requested port is valid and free, that exact port is used (so the port typed
 * into the form actually takes effect). Otherwise, or when the fixed port is
 * already in use, a free port is allocated from the pool.
 */
export function chooseLaunchPort(
  agentId: string,
  input: LaunchPortChoiceInput,
): LaunchPortChoice {
  const validFixed =
    !input.autoPort &&
    Number.isInteger(input.requestedPort) &&
    input.requestedPort >= 1 &&
    input.requestedPort <= 65535 &&
    !input.isReserved(input.requestedPort);

  if (validFixed) {
    const reserved = input.reserveFixed(agentId, input.requestedPort);
    if (reserved) {
      return { port: input.requestedPort, id: `${agentId}-fixed`, fixed: true };
    }
  }

  const alloc = input.allocateAuto(agentId);
  return { port: alloc.port, id: alloc.id, fixed: false, release: alloc.release };
}
