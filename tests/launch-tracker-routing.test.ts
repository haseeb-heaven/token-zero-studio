/**
 * Helpers for mapping ProcessManager alloc ids ↔ LaunchTracker record ids.
 */
import { describe, expect, it } from 'vitest';
import {
  LaunchTracker,
  resolveTrackerId,
  mergeWorkflowOutput,
} from '../src/core/launch-records';

describe('resolveTrackerId', () => {
  it('maps alloc id to tracker id', () => {
    const map = new Map([['codex-1', 'launch-abc-1']]);
    expect(resolveTrackerId(map, 'codex-1')).toBe('launch-abc-1');
  });

  it('returns undefined for unknown alloc id', () => {
    const map = new Map([['codex-1', 'launch-abc-1']]);
    expect(resolveTrackerId(map, 'codex-2')).toBeUndefined();
  });

  it('returns undefined for empty/undefined input', () => {
    expect(resolveTrackerId(new Map(), undefined)).toBeUndefined();
    expect(resolveTrackerId(new Map(), '')).toBeUndefined();
  });
});

describe('LaunchTracker runtime updates via alloc→tracker map', () => {
  it('setState/get must use tracker id, not alloc id', () => {
    const tracker = new LaunchTracker();
    const map = new Map<string, string>();
    const lr = tracker.start({
      agentId: 'codex',
      compressorId: 'headroom',
      profile: 'Default',
      cwd: '.',
      command: 'codex',
      env: {},
      port: 8400,
    });
    map.set('codex-1', lr.id);

    // Bug: using alloc id against LaunchTracker is a no-op.
    expect(tracker.setState('codex-1', 'running')).toBeUndefined();
    expect(tracker.get('codex-1')).toBeUndefined();

    // Fix: resolve through the map first.
    const tid = resolveTrackerId(map, 'codex-1')!;
    expect(tracker.setState(tid, 'running')?.state).toBe('running');
    expect(tracker.get(tid)?.state).toBe('running');
  });

  it('appended spawn output is available for session hydration', () => {
    const tracker = new LaunchTracker();
    const lr = tracker.start({
      agentId: 'codex',
      compressorId: 'headroom',
      profile: 'Default',
      cwd: '.',
      command: 'codex',
      env: {},
      port: 8400,
    });
    tracker.appendOutput(lr.id, 'Spawning OpenAI Codex CLI: /opt/homebrew/bin/codex');
    tracker.appendOutput(lr.id, 'PTY launch OpenAI Codex CLI via /usr/bin/python3');
    tracker.setState(lr.id, 'running');

    const record = tracker.get(lr.id)!;
    const hydrated = mergeWorkflowOutput(
      ['Session started on port 8400'],
      record.output,
    );
    expect(hydrated[0]).toContain('Spawning OpenAI Codex CLI');
    expect(hydrated.some((l) => l.includes('PTY launch'))).toBe(true);
    expect(hydrated).not.toEqual(['Session started on port 8400']);
  });
});

describe('mergeWorkflowOutput', () => {
  it('prefers tracker output when it has content', () => {
    expect(mergeWorkflowOutput(['placeholder'], ['real line 1', 'real line 2'])).toEqual([
      'real line 1',
      'real line 2',
    ]);
  });

  it('keeps placeholder when tracker output is empty', () => {
    expect(mergeWorkflowOutput(['Session started'], [])).toEqual(['Session started']);
  });

  it('keeps placeholder when tracker output is undefined', () => {
    expect(mergeWorkflowOutput(['Session started'], undefined)).toEqual(['Session started']);
  });
});
