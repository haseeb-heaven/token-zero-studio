import type { ProxyDefinition } from './types';

/**
 * Registry of token-optimisation proxies supported by Token Zero Studio.
 *
 * - **Headroom**: local HTTP proxy that compresses context (headroom-ai).
 * - **PxPipe**: local proxy that renders context as PNG image blocks.
 * - **RTK**: Rust binary that rewrites shell commands (not a server proxy).
 * - **Custom**: user-defined binary + args + base URL pattern.
 */
export const PROXIES: ProxyDefinition[] = [
  {
    id: 'headroom',
    name: 'Headroom',
    description: 'Context optimization proxy — compresses agent traffic to cut token spend.',
    mode: 'server',
    executables: ['headroom'],
    wellKnownPaths: {
      win32: ['~\\AppData\\Roaming\\Python\\Scripts\\headroom.exe', '~\\.local\\bin\\headroom.exe'],
      darwin: ['/usr/local/bin/headroom', '/opt/homebrew/bin/headroom', '~/.local/bin/headroom'],
      linux: ['/usr/local/bin/headroom', '~/.local/bin/headroom', '/usr/bin/headroom'],
    },
    detectCommand: 'headroom --version',
    defaultPort: 8989,
    defaultFlags: {
      memory: true,
      learn: true,
      mode: 'cache',
    },
    buildStartArgs: (port, flags) => {
      const args = ['proxy', '--port', String(port), '--mode', flags.mode ?? 'cache'];
      if (flags.noOptimize) args.push('--no-optimize');
      if (flags.lossless) args.push('--lossless');
      if (flags.memory) args.push('--memory');
      if (flags.learn) args.push('--learn');
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'pip install headroom-ai',
    accent: '#38bdf8',
    homepage: 'https://github.com',
  },
  {
    id: 'pxpipe',
    name: 'PxPipe',
    description: 'Renders token-dense context as PNG image blocks for multimodal models.',
    mode: 'server',
    executables: ['pxpipe-proxy'],
    wellKnownPaths: {
      win32: ['%LOCALAPPDATA%\\npx\\pxpipe-proxy.cmd'],
      darwin: ['/usr/local/bin/pxpipe-proxy', '/opt/homebrew/bin/pxpipe-proxy'],
      linux: ['/usr/local/bin/pxpipe-proxy', '~/.local/bin/pxpipe-proxy'],
    },
    detectCommand: 'pxpipe-proxy --version',
    defaultPort: 47821,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'anthropic',
    installInstructions: 'npx pxpipe-proxy (or npm install -g pxpipe)',
    accent: '#a78bfa',
    homepage: 'https://pxpipe.dev',
  },
  {
    id: 'rtk',
    name: 'RTK',
    description: 'Rust Token Killer — rewrites shell commands to compress output before it reaches your agent.',
    mode: 'wrapper',
    executables: ['rtk'],
    wellKnownPaths: {
      win32: ['~\\.local\\bin\\rtk.exe', 'C:\\Users\\Public\\bin\\rtk.exe'],
      darwin: ['/usr/local/bin/rtk', '/opt/homebrew/bin/rtk', '~/.local/bin/rtk'],
      linux: ['/usr/local/bin/rtk', '~/.local/bin/rtk'],
    },
    detectCommand: 'rtk --version',
    defaultPort: 0, // wrapper mode — no server port
    defaultFlags: {},
    buildStartArgs: () => [], // RTK doesn't start a server
    envStyle: 'none',
    installInstructions: 'brew install rtk  (macOS) | curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh  (Linux)',
    accent: '#fb7185',
    homepage: 'https://github.com/rtk-ai/rtk',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'User-defined proxy binary with custom start arguments and base URL.',
    mode: 'server',
    executables: [],
    wellKnownPaths: {},
    detectCommand: 'echo custom',
    defaultPort: 8989,
    defaultFlags: {},
    buildStartArgs: (_port, flags) => {
      const args = flags.extraArgs ? flags.extraArgs.split(/\s+/) : [];
      return args;
    },
    envStyle: 'both',
    installInstructions: 'Configure the binary path and start arguments in Settings.',
    accent: '#6b7280',
    homepage: 'https://',
  },
];

const byId = new Map(PROXIES.map((p) => [p.id, p]));

/** Look up a proxy definition by id. Throws on unknown id. */
export function getProxy(id: string): ProxyDefinition {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`Unknown proxy id: ${id}`);
  }
  return found;
}

/** True when a proxy id exists in the registry. */
export function hasProxy(id: string): boolean {
  return byId.has(id);
}

/** All proxy ids. */
export function proxyIds(): string[] {
  return PROXIES.map((p) => p.id);
}
