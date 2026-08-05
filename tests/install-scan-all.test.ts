/**
 * Install→scan coverage for EVERY agent and EVERY compressor, one by one.
 *
 * For each registered agent/compressor on every platform:
 *  1. it must expose at least one install option with a non-empty command
 *  2. the preferred (first) option must be a durable PATH install where a real
 *     one exists (npm/uv/pip/pipx/brew/cargo), not an ephemeral npx/docs stub
 *  3. if the preferred option is durable, the uninstall/update commands must
 *     derive non-empty (Remove/Update buttons work)
 *  4. after "installing" into the platform's user-bin dir, scanAgent must find
 *     the binary (post-install detection loop)
 */
import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/core/agents';
import { getAgentInstallOptions } from '../src/core/agent-install';
import {
  deriveUninstallCommand,
  deriveUpdateCommand,
  getProxyInstallOptions,
} from '../src/core/proxy-install';
import { proxyIds, getProxy } from '../src/core/proxies/registry';
import { scanAgent } from '../src/core/scanner';
import { userBinDirs } from '../src/core/platform';
import type { PlatformContext } from '../src/core/platform';
import type { AgentDefinition, PlatformName } from '../src/shared/types';

const PLATFORMS: PlatformName[] = ['darwin', 'linux', 'win32'];

function ctxFor(platform: PlatformName, installedBins: string[], execName: string): PlatformContext {
  const home = platform === 'win32' ? 'C:\\Users\\test' : '/Users/test';
  const files: Record<string, boolean> = {};
  for (const dir of userBinDirs(platform, home)) {
    const sep = platform === 'win32' ? '\\' : '/';
    files[`${dir}${sep}${execName}`] = true;
  }
  return {
    platform,
    homeDir: home,
    env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' },
    exists: (p) => !!files[p] || installedBins.includes(p),
    isFile: (p) => !!files[p] || installedBins.includes(p),
    readdir: () => [],
  };
}

function asAgentDef(id: string, executables: string[]): AgentDefinition {
  return {
    id,
    name: id,
    vendor: 'test',
    description: '',
    interfaceType: 'cli',
    launchStrategy: 'env',
    executables,
    wellKnownPaths: {},
    envStyle: 'both',
    defaultArgs: [],
    configFileHint: '',
    defaultPort: 0,
    accent: '',
    homepage: '',
  };
}

const DURABLE = /npm install|uv tool|pip3? install|pipx install|cargo install|brew install|curl|install\.sh|gh extension install|powershell|irm |iex/;
/** GUI launcher / docs-openers that are intentionally first for GUI apps. */
const GUI_LAUNCHER = /^(open|xdg-open|start)\s|https?:\/\//;

describe('install→scan for every agent (one by one)', () => {
  for (const platform of PLATFORMS) {
    for (const agent of AGENTS) {
      it(`${agent.id}@${platform}: has install options, durable first, scan finds installed bin`, () => {
        const opts = getAgentInstallOptions(agent.id, platform);
        expect(opts.length, `${agent.id}@${platform} options`).toBeGreaterThan(0);
        const first = opts[0];
        expect(first.command.trim().length, `${agent.id}@${platform} first command`).toBeGreaterThan(0);
        // Durable-first when any durable source exists; GUI/docs launchers and
        // docs stubs are allowed only when nothing real is available (single
        // option) or the first option is a GUI launcher (open/xdg-open/start).
        const hasDurable = opts.some((o) => DURABLE.test(o.command));
        if (hasDurable) {
          const firstIsGuiLauncher = GUI_LAUNCHER.test(first.command);
          expect(
            firstIsGuiLauncher || DURABLE.test(first.command),
            `${agent.id}@${platform} durable first`,
          ).toBe(true);
        }
        // Remove/Update derive for package-manager options (npm/uv/pip/pipx/
        // brew/cargo). curl/native/docs installers have no clean uninstall.
        const durable = opts.find((o) => DURABLE.test(o.command));
        if (durable && ['npm', 'uv', 'pip', 'pipx', 'brew', 'cargo'].includes(durable.id)) {
          expect(deriveUninstallCommand(durable).trim(), `${agent.id} uninstall`).not.toBe('');
          expect(deriveUpdateCommand(durable).trim(), `${agent.id} update`).not.toBe('');
        }
        // Post-install detection: binary placed in the platform user-bin dirs.
        for (const exe of agent.executables.slice(0, 1)) {
          const ctx = ctxFor(platform, [], exe);
          const scan = scanAgent(asAgentDef(agent.id, agent.executables), ctx);
          expect(scan.found, `${agent.id}@${platform} scan after install`).toBe(true);
          expect(scan.paths.length, `${agent.id}@${platform} paths`).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('install→scan for every compressor (one by one)', () => {
  for (const platform of PLATFORMS) {
    for (const id of proxyIds()) {
      it(`${id}@${platform}: has install options, durable first, scan finds installed bin`, () => {
        const opts = getProxyInstallOptions(id, platform);
        expect(opts.length, `${id}@${platform} options`).toBeGreaterThan(0);
        const first = opts[0];
        expect(first.command.trim().length, `${id}@${platform} first command`).toBeGreaterThan(0);
        const hasDurable = opts.some((o) => DURABLE.test(o.command));
        if (hasDurable) {
          const firstIsGuiLauncher = GUI_LAUNCHER.test(first.command);
          expect(
            firstIsGuiLauncher || DURABLE.test(first.command),
            `${id}@${platform} durable first`,
          ).toBe(true);
        }
        const durable = opts.find((o) => DURABLE.test(o.command));
        if (durable && ['npm', 'uv', 'pip', 'pipx', 'brew', 'cargo'].includes(durable.id)) {
          expect(deriveUninstallCommand(durable).trim(), `${id} uninstall`).not.toBe('');
          expect(deriveUpdateCommand(durable).trim(), `${id} update`).not.toBe('');
        }
        const def = getProxy(id);
        for (const exe of def.executables.slice(0, 1)) {
          const ctx = ctxFor(platform, [], exe);
          const scan = scanAgent(asAgentDef(id, def.executables), ctx);
          expect(scan.found, `${id}@${platform} scan after install`).toBe(true);
          expect(scan.paths.length, `${id}@${platform} paths`).toBeGreaterThan(0);
        }
      });
    }
  }
});
