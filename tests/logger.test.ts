import { describe, expect, it } from 'vitest';
import { Logger } from '../src/core/logger';

describe('Logger', () => {
  it('records entries with level, source, message and timestamp', () => {
    const log = new Logger();
    log.info('app', 'hello');
    log.error('proxy', 'boom');
    const entries = log.list();
    expect(entries.length).toBe(2);
    expect(entries[0].level).toBe('info');
    expect(entries[0].source).toBe('app');
    expect(entries[0].message).toBe('hello');
    expect(typeof entries[0].timestamp).toBe('number');
    expect(entries[1].level).toBe('error');
  });

  it('supports all level helpers', () => {
    const log = new Logger();
    log.debug('s', 'd');
    log.info('s', 'i');
    log.warn('s', 'w');
    log.error('s', 'e');
    expect(log.list().map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('caps the ring buffer at maxEntries', () => {
    const log = new Logger(5);
    for (let i = 0; i < 10; i++) log.info('app', `m${i}`);
    expect(log.size).toBe(5);
    expect(log.list()[0].message).toBe('m5');
    expect(log.list()[4].message).toBe('m9');
  });

  it('rejects maxEntries < 1', () => {
    expect(() => new Logger(0)).toThrow();
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const log = new Logger();
    const seen: string[] = [];
    const unsub = log.subscribe((e) => seen.push(e.message));
    log.info('app', 'one');
    unsub();
    log.info('app', 'two');
    expect(seen).toEqual(['one']);
  });

  it('a throwing listener does not break logging', () => {
    const log = new Logger();
    log.subscribe(() => {
      throw new Error('bad listener');
    });
    expect(() => log.info('app', 'x')).not.toThrow();
    expect(log.size).toBe(1);
  });

  it('clear empties the buffer', () => {
    const log = new Logger();
    log.info('app', 'x');
    log.clear();
    expect(log.size).toBe(0);
  });
});
