/**
 * Multi-option compressor install catalog + post-install path discovery.
 */
import { describe, expect, it } from 'vitest';
import {
  getProxyInstallOptions,
  pickPreferredInstallCommand,
  resolveInstallShell,
} from '../src/core/proxy-install';
import { userBinDirs, mergePathWithUserBins } from '../src/core/platform';
import { scanAgent } from '../src/core/scanner';
import { getProxy } from '../src/core/proxies/registry';
import type { PlatformContext } from '../src/core/platform';

function fakeCtx(
  platform: 'darwin' | 'linux' | 'win32',
  files: Record<string, boolean>,
  env: Record<string, string> = {},
): PlatformContext {
  const home = platform === 'win32' ? 'C:\\Users\\test' : '/Users/test';
  return {
    platform,
    homeDir: home,
    env: { HOME: home, USERPROFILE: home, PATH: env.PATH ?? '', ...env },
    exists: (p) => !!files[p],
    isFile: (p) => !!files[p],
    readdir: () => [],
  };
}

describe('getProxyInstallOptions', () => {
  it('returns multiple install options for headroom on darwin', () => {
    const opts = getProxyInstallOptions('headroom', 'darwin');
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(['uv', 'pip', 'pipx']));
    expect(opts.every((o) => o.command.length > 0)).toBe(true);
  });

  it('returns multiple install options for headroom on win32', () => {
    const opts = getProxyInstallOptions('headroom', 'win32');
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.some((o) => /pip|uv|pipx/i.test(o.command))).toBe(true);
  });

  it('returns brew + curl options for rtk on darwin (correct tap)', () => {
    const opts = getProxyInstallOptions('rtk', 'darwin');
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.some((o) => o.command.includes('rtk-ai/tap/rtk'))).toBe(true);
    expect(opts.some((o) => o.command.includes('install.sh'))).toBe(true);
  });

  it('returns at least one option for every registered compressor on all platforms', () => {
    const platforms = ['darwin', 'linux', 'win32'] as const;
    const ids = [
      'headroom', 'pxpipe', 'rtk', 'llmlingua', 'tokenshift', 'caveman', 'leanctx',
      'supercompress', 'selective-ctx', 'squeez', 'omni-route', 'graphify', 'ponytail',
    ];
    for (const platform of platforms) {
      for (const id of ids) {
        const opts = getProxyInstallOptions(id, platform);
        expect(opts.length, `${id}@${platform}`).toBeGreaterThan(0);
      }
    }
  });

  it('offers multiple install sources for every compressor on darwin (so the UI shows a fallback chain)', () => {
    const ids = [
      'headroom', 'pxpipe', 'rtk', 'llmlingua', 'tokenshift', 'caveman', 'leanctx',
      'supercompress', 'selective-ctx', 'squeez', 'omni-route', 'graphify', 'ponytail',
    ];
    for (const id of ids) {
      const opts = getProxyInstallOptions(id, 'darwin');
      expect(opts.length, `${id} darwin`).toBeGreaterThan(1);
      const idset = new Set(opts.map((o) => o.id));
      // Distinct channels — no accidental duplicate install methods.
      expect(idset.size, `${id} distinct channels`).toBe(opts.length);
      expect(opts.every((o) => o.command.trim().length > 0), `${id} non-empty`).toBe(true);
    }
  });

  it('prefers durable PATH installs (npm/uv/pip) over ephemeral npx as the first option', () => {
    for (const id of ['supercompress', 'squeez', 'omni-route', 'graphify', 'ponytail']) {
      const first = pickPreferredInstallCommand(id, 'darwin');
      expect(first, id).toMatch(/npm install|uv tool|pip3 install|cargo install|curl|brew install/);
      expect(first, id).not.toMatch(/^npx /);
    }
  });

  it('every uv/pipx/npm install lands in a PATH that scanAgent can see (post-install detection)', () => {
    const ctx = fakeCtx('darwin', {
      '/Users/test/.local/bin/supercompress': true,
      '/Users/test/.local/bin/graphify': true,
      '/Users/test/.local/bin/ponytail': true,
      '/Users/test/.local/bin/squeez': true,
      '/Users/test/.local/bin/selective-ctx': true,
    }, { PATH: '/usr/bin:/bin', HOME: '/Users/test' });
    for (const [id, exe] of [
      ['supercompress', 'supercompress'],
      ['graphify', 'graphify'],
      ['ponytail', 'ponytail'],
      ['squeez', 'squeez'],
      ['selective-ctx', 'selective-ctx'],
    ] as const) {
      const def = getProxy(id);
      const agentDef = {
        id,
        name: def.name,
        vendor: def.name,
        description: '',
        interfaceType: 'cli' as const,
        launchStrategy: 'env' as const,
        executables: [exe],
        wellKnownPaths: def.wellKnownPaths,
        envStyle: 'both' as const,
        defaultArgs: [],
        configFileHint: '',
        defaultPort: 0,
        accent: '',
        homepage: '',
      };
      const scan = scanAgent(agentDef, ctx);
      expect(scan.found, `${id} detected after install`).toBe(true);
    }
  });

  it('pickPreferredInstallCommand returns first option command', () => {
    const cmd = pickPreferredInstallCommand('headroom', 'linux');
    expect(cmd).toContain('headroom-ai');
  });

  it('resolveInstallShell uses cmd on win32 and sh elsewhere', () => {
    expect(resolveInstallShell('win32')).toEqual({ shell: 'cmd.exe', flag: '/c' });
    expect(resolveInstallShell('darwin')).toEqual({ shell: '/bin/sh', flag: '-c' });
    expect(resolveInstallShell('linux')).toEqual({ shell: '/bin/sh', flag: '-c' });
  });
});

describe('userBinDirs + PATH merge (post-install locate)', () => {
  it('lists common user bin dirs for each platform', () => {
    expect(userBinDirs('darwin', '/Users/test')).toEqual(
      expect.arrayContaining(['/Users/test/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']),
    );
    expect(userBinDirs('linux', '/home/test')).toEqual(
      expect.arrayContaining(['/home/test/.local/bin', '/usr/local/bin']),
    );
    expect(userBinDirs('win32', 'C:\\Users\\test').some((d) => d.includes('Python') || d.includes('.local'))).toBe(true);
  });

  it('mergePathWithUserBins prepends missing user bins to PATH', () => {
    const merged = mergePathWithUserBins('/usr/bin', 'darwin', '/Users/test');
    expect(merged.startsWith('/Users/test/.local/bin')).toBe(true);
    expect(merged).toContain('/usr/bin');
  });

  it('scan finds headroom in ~/.local/bin even when PATH is empty (Electron-like)', () => {
    const ctx = fakeCtx('darwin', {
      '/Users/test/.local/bin/headroom': true,
    });
    const agentDef = {
      id: 'headroom',
      name: 'Headroom',
      vendor: 'Headroom',
      description: '',
      interfaceType: 'cli' as const,
      launchStrategy: 'env' as const,
      executables: ['headroom'],
      wellKnownPaths: getProxy('headroom').wellKnownPaths,
      envStyle: 'both' as const,
      defaultArgs: [],
      configFileHint: '',
      defaultPort: 8989,
      accent: '',
      homepage: '',
    };
    const scan = scanAgent(agentDef, ctx);
    expect(scan.found).toBe(true);
    expect(scan.paths[0]).toBe('/Users/test/.local/bin/headroom');
  });

  it('scan finds binary via augmented user bins when only PATH dirs are empty but file exists under user bin', () => {
    const ctx = fakeCtx('linux', {
      '/home/test/.local/bin/rtk': true,
    }, { PATH: '/usr/bin', HOME: '/home/test' });
    ctx.homeDir = '/home/test';
    const agentDef = {
      id: 'rtk',
      name: 'RTK',
      vendor: 'RTK',
      description: '',
      interfaceType: 'cli' as const,
      launchStrategy: 'env' as const,
      executables: ['rtk'],
      wellKnownPaths: getProxy('rtk').wellKnownPaths,
      envStyle: 'none' as const,
      defaultArgs: [],
      configFileHint: '',
      defaultPort: 0,
      accent: '',
      homepage: '',
    };
    const scan = scanAgent(agentDef, ctx);
    expect(scan.found).toBe(true);
    expect(scan.paths.some((p) => p.endsWith('/rtk'))).toBe(true);
  });
});
