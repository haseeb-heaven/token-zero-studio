/**
 * Tests for agent multi-option install catalog + port UX rules.
 */
import { describe, expect, it } from 'vitest';
import { getAgentInstallOptions, pickPreferredAgentInstallCommand } from '../src/core/agent-install';
import { chooseLaunchPort } from '../src/core/port-allocator';
import { formatStdinPayload } from '../src/core/launcher';

describe('getAgentInstallOptions', () => {
  it('returns multiple options for claude on darwin', () => {
    const opts = getAgentInstallOptions('claude', 'darwin');
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.some((o) => o.command.includes('curl') || o.command.includes('npm'))).toBe(true);
  });

  it('returns npm install for codex', () => {
    const cmd = pickPreferredAgentInstallCommand('codex', 'linux');
    expect(cmd).toContain('npm install');
  });

  it('returns at least one option for unknown agents (generic npm)', () => {
    const opts = getAgentInstallOptions('my-custom-cli', 'darwin');
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0].command).toContain('npm install');
  });

  it('returns multiple options for opencode and goose', () => {
    expect(getAgentInstallOptions('opencode', 'darwin').length).toBeGreaterThan(1);
    expect(getAgentInstallOptions('goose', 'linux').length).toBeGreaterThan(0);
  });
});

describe('chooseLaunchPort honors fixed port when autoPort is false', () => {
  it('uses requested port when autoPort is false', () => {
    const choice = chooseLaunchPort('codex', {
      autoPort: false,
      requestedPort: 9123,
      isReserved: () => false,
      reserveFixed: () => true,
      allocateAuto: () => ({ id: 'codex-1', port: 8400, release: () => {} }),
    });
    expect(choice.port).toBe(9123);
    expect(choice.fixed).toBe(true);
    expect(choice.id).toBe('codex-fixed');
  });

  it('auto-allocates when autoPort is true even if requestedPort is set', () => {
    const choice = chooseLaunchPort('codex', {
      autoPort: true,
      requestedPort: 9123,
      isReserved: () => false,
      reserveFixed: () => true,
      allocateAuto: () => ({ id: 'codex-1', port: 8400, release: () => {} }),
    });
    expect(choice.port).toBe(8400);
    expect(choice.fixed).toBe(false);
  });
});

describe('formatStdinPayload vs raw TUI keys', () => {
  it('line mode appends newline for normal text', () => {
    expect(formatStdinPayload('hi')).toBe('hi\n');
  });

  it('control chars stay bare (xterm sends these via raw write)', () => {
    expect(formatStdinPayload('\u0003')).toBe('\u0003');
  });
});
