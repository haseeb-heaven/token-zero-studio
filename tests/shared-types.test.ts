/**
 * Shared type constants (src/shared/types.ts) — IPC channel names must be
 * unique and follow the channel:action convention so preload and main agree.
 */
import { describe, expect, it } from 'vitest';
import { IPC } from '../src/shared/types';

describe('IPC channel names', () => {
  it('exposes every expected channel', () => {
    const expected = [
      'AgentsList', 'ScanAll', 'ScanAgent', 'HeadroomDetect', 'ProxyList',
      'ProxyDetect', 'InstallProxy', 'InstallProxyOptions', 'UninstallProxy',
      'UpdateProxy', 'InstallAgent', 'InstallAgentOptions', 'ConfigGet',
      'ConfigSave', 'LaunchStart', 'LaunchStop', 'LaunchEmbedded', 'RuntimeAll',
      'LogsList', 'LogsClear', 'PickExecutable', 'PickDirectory', 'OpenPath',
      'OpenUrl', 'PortCheck', 'PortKill', 'CompatibilityGet', 'CompatibleAgents',
      'CustomAgentSave', 'CustomAgentDelete', 'CustomProxySave', 'CustomProxyDelete',
      'LaunchesList', 'EventLog', 'EventRuntime',
    ];
    for (const key of expected) {
      expect(typeof IPC[key as keyof typeof IPC], key).toBe('string');
    }
  });

  it('has unique channel strings (no accidental collisions)', () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });

  it('follows the channel:action convention', () => {
    for (const [key, value] of Object.entries(IPC)) {
      expect(value, key).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });
});
