import { describe, expect, it } from 'vitest';
import { PortAllocator, PORT_ALLOCATOR_RANGE, chooseLaunchPort } from '../src/core/port-allocator';

describe('PortAllocator', () => {
  it('allocates ports from the configured range', () => {
    const alloc = new PortAllocator();
    const result = alloc.allocate('claude');
    expect(result.port).toBeGreaterThanOrEqual(PORT_ALLOCATOR_RANGE[0]);
    expect(result.port).toBeLessThanOrEqual(PORT_ALLOCATOR_RANGE[1]);
    expect(typeof result.release).toBe('function');
    result.release();
  });

  it('returns distinct ports for concurrent allocations of the same agent', () => {
    const alloc = new PortAllocator();
    const a = alloc.allocate('claude');
    const b = alloc.allocate('claude');
    expect(a.port).not.toBe(b.port);
    a.release();
    b.release();
  });

  it('returns distinct ports for different agents', () => {
    const alloc = new PortAllocator();
    const a = alloc.allocate('claude');
    const b = alloc.allocate('codex');
    expect(a.port).not.toBe(b.port);
    a.release();
    b.release();
  });

  it('reuses a released port on the next allocation', () => {
    const alloc = new PortAllocator();
    const a = alloc.allocate('claude');
    const port = a.port;
    a.release();
    const b = alloc.allocate('claude');
    expect(b.port).toBe(port);
    b.release();
  });

  it('throws when all ports in range are exhausted', () => {
    const alloc = new PortAllocator({ range: [9000, 9002] });
    const a = alloc.allocate('a');
    const b = alloc.allocate('b');
    const c = alloc.allocate('c');
    expect(() => alloc.allocate('d')).toThrow(/No free ports/);
    a.release();
    b.release();
    c.release();
  });

  it('tracks allocated ports per id and returns allocation info', () => {
    const alloc = new PortAllocator();
    const a = alloc.allocate('claude');
    const b = alloc.allocate('claude');
    const allocations = alloc.getAllocations();
    expect(allocations.length).toBe(2);
    expect(allocations.every((x) => x.agentId === 'claude')).toBe(true);
    expect(new Set(allocations.map((x) => x.port)).size).toBe(2);
    a.release();
    b.release();
    expect(alloc.getAllocations().length).toBe(0);
  });

  it('release on unknown id is a no-op', () => {
    const alloc = new PortAllocator();
    expect(() => alloc.release('nonexistent')).not.toThrow();
  });

  it('throws when port range is fully saturated', () => {
    const alloc = new PortAllocator({ range: [9000, 9000] });
    const a = alloc.allocate('claude');
    expect(() => alloc.allocate('claude')).toThrow(/No free ports/);
    a.release();
  });
});

describe('PortAllocator fixed-port reservation', () => {
  it('isReserved reflects active allocations', () => {
    const alloc = new PortAllocator();
    expect(alloc.isReserved(9000)).toBe(false);
    const slot = alloc.allocate('claude');
    expect(alloc.isReserved(slot.port)).toBe(true);
    slot.release();
    expect(alloc.isReserved(slot.port)).toBe(false);
  });

  it('reserve() reserves an exact fixed port under <agentId>-fixed', () => {
    const alloc = new PortAllocator();
    const r = alloc.reserve('claude', 9100);
    expect(r.port).toBe(9100);
    expect(r.id).toBe('claude-fixed');
    expect(alloc.isReserved(9100)).toBe(true);
    r.release();
    expect(alloc.isReserved(9100)).toBe(false);
  });

  it('reserve() falls back to an auto port when the fixed port is taken', () => {
    const alloc = new PortAllocator();
    const first = alloc.reserve('claude', 9101); // fixed
    const second = alloc.reserve('claude', 9101); // collides -> auto alloc
    expect(first.port).toBe(9101);
    expect(second.port).not.toBe(9101);
    first.release();
    second.release();
  });
});

describe('chooseLaunchPort', () => {
  const makeDeps = (overrides: Record<string, unknown> = {}) => {
    const alloc = new PortAllocator({ range: [8400, 8499] });
    let fixedCalls = 0;
    const deps = {
      autoPort: false,
      requestedPort: 9001,
      isReserved: (p: number) => alloc.isReserved(p),
      reserveFixed: (id: string, p: number) => {
        fixedCalls++;
        return alloc.reserve(id, p).port === p;
      },
      allocateAuto: (id: string) => alloc.allocate(id),
      ...overrides,
    };
    return { deps, alloc, count: () => fixedCalls } as {
      deps: Parameters<typeof chooseLaunchPort>[1];
      alloc: PortAllocator;
      count: () => number;
    };
  };

  it('uses the user fixed port when autoPort is disabled and the port is free', () => {
    const { deps, count } = makeDeps({ requestedPort: 9123 });
    const result = chooseLaunchPort('claude', deps);
    expect(result.port).toBe(9123);
    expect(result.fixed).toBe(true);
    expect(result.id).toBe('claude-fixed');
    expect(count()).toBe(1);
  });

  it('reserves the fixed port so a later launch cannot reuse it', () => {
    const { deps, alloc } = makeDeps({ requestedPort: 9124 });
    const first = chooseLaunchPort('claude', deps);
    expect(alloc.isReserved(9124)).toBe(true);
    first.release?.();
  });

  it('auto-assigns when autoPort is enabled (default behaviour)', () => {
    const { deps, count } = makeDeps({ autoPort: true, requestedPort: 9125 });
    const result = chooseLaunchPort('claude', deps);
    expect(result.fixed).toBe(false);
    expect(count()).toBe(0);
    expect(result.port).not.toBe(9125);
    result.release?.();
  });

  it('auto-assigns a different port when the fixed port is already in use', () => {
    const { deps } = makeDeps({ requestedPort: 9126 });
    const first = chooseLaunchPort('claude', deps); // occupies 9126
    const second = chooseLaunchPort('claude', deps); // must avoid 9126
    expect(first.port).toBe(9126);
    expect(second.port).not.toBe(9126);
    expect(second.fixed).toBe(false);
    first.release?.();
    second.release?.();
  });

  it('treats a reserved fixed port as unavailable and falls back to auto', () => {
    const { deps, alloc } = makeDeps({ requestedPort: 9127 });
    alloc.reserve('other-agent', 9127); // external process already on this port
    const result = chooseLaunchPort('claude', deps);
    expect(result.port).not.toBe(9127);
    expect(result.fixed).toBe(false);
    result.release?.();
  });
});
