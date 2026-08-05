import type { ProxyDefinition } from './types';

/**
 * Registry of token-optimisation proxies supported by Token Zero Studio.
 *
 * - **Headroom**: local HTTP proxy that compresses context (headroom-ai).
 * - **PxPipe**: local proxy that renders context as PNG image blocks.
 * - **RTK**: Rust binary that rewrites shell commands (not a server proxy).
 * - **LLMLingua**: Microsoft prompt and KV-cache compressor (llmlingua).
 * - **TokenShift**: Endpoint-level token optimization & governance.
 * - **Caveman**: Output compression skill for concise responses.
 * - **LeanCTX**: Context intelligence layer & shell-hook MCP context compressor.
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
    installInstructions: 'uv tool install "headroom-ai[all]"  |  pip install "headroom-ai[all]"  |  pipx install "headroom-ai[all]"',
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
    installInstructions: 'npx pxpipe-proxy (or npm install -g pxpipe-proxy)',
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
    installInstructions: 'brew install rtk-ai/tap/rtk  |  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh',
    accent: '#fb7185',
    homepage: 'https://github.com/rtk-ai/rtk',
  },
  {
    id: 'llmlingua',
    name: 'LLMLingua',
    description: 'Microsoft LLMLingua-2 perplexity-based prompt compressor proxy gateway.',
    mode: 'server',
    executables: ['llmlingua', 'llmlingua-proxy'],
    wellKnownPaths: {
      win32: ['~\\AppData\\Roaming\\Python\\Scripts\\llmlingua.exe', '~\\.local\\bin\\llmlingua.exe'],
      darwin: ['/usr/local/bin/llmlingua', '/opt/homebrew/bin/llmlingua', '~/.local/bin/llmlingua'],
      linux: ['/usr/local/bin/llmlingua', '~/.local/bin/llmlingua'],
    },
    detectCommand: 'llmlingua --version',
    defaultPort: 8991,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'pip install llmlingua',
    accent: '#10b981',
    homepage: 'https://github.com/microsoft/LLMLingua',
  },
  {
    id: 'tokenshift',
    name: 'TokenShift',
    description: 'Endpoint-level token optimization and governance for coding agents.',
    mode: 'server',
    executables: ['tokenshift', 'tokenshift-proxy'],
    wellKnownPaths: {
      win32: ['C:\\Program Files\\TokenShift\\tokenshift.exe', '~\\.tokenshift\\bin\\tokenshift.exe', '~\\.local\\bin\\tokenshift.exe'],
      darwin: ['/usr/local/bin/tokenshift', '/opt/homebrew/bin/tokenshift', '~/.tokenshift/bin/tokenshift'],
      linux: ['/usr/local/bin/tokenshift', '~/.local/bin/tokenshift'],
    },
    detectCommand: 'tokenshift --version',
    defaultPort: 8992,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'Download local binary installer from https://www.pointfive.co/tokenshift',
    accent: '#3b82f6',
    homepage: 'https://www.pointfive.co/tokenshift',
  },
  {
    id: 'caveman',
    name: 'Caveman',
    description: 'Output compression skill for ultra-concise, high-signal responses across 30+ agents.',
    mode: 'wrapper',
    executables: ['caveman'],
    wellKnownPaths: {
      win32: ['~\\.caveman\\bin\\caveman.exe', '~\\.local\\bin\\caveman.exe', '%LOCALAPPDATA%\\npx\\caveman.cmd'],
      darwin: ['/usr/local/bin/caveman', '/opt/homebrew/bin/caveman', '~/.local/bin/caveman', '~/.caveman/bin/caveman'],
      linux: ['/usr/local/bin/caveman', '~/.local/bin/caveman', '~/.caveman/bin/caveman'],
    },
    detectCommand: 'caveman --version',
    defaultPort: 0,
    defaultFlags: {},
    buildStartArgs: () => [],
    envStyle: 'none',
    installInstructions: 'npx -y github:JuliusBrussee/caveman (npm) | irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex (Windows)',
    accent: '#eab308',
    homepage: 'https://getcaveman.dev/docs',
  },
  {
    id: 'leanctx',
    name: 'LeanCTX',
    description: 'Context intelligence layer & shell-hook MCP context compressor for AI workflows.',
    mode: 'server',
    executables: ['leanctx', 'lean-ctx'],
    wellKnownPaths: {
      win32: ['C:\\Program Files\\LeanCTX\\leanctx.exe', '~\\.leanctx\\bin\\leanctx.exe', '~\\.local\\bin\\leanctx.exe'],
      darwin: ['/usr/local/bin/leanctx', '/opt/homebrew/bin/leanctx', '~/.local/bin/leanctx'],
      linux: ['/usr/local/bin/leanctx', '~/.local/bin/leanctx'],
    },
    detectCommand: 'leanctx --version',
    defaultPort: 8993,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'Follow installation guide at https://leanctx.com/docs/getting-started/',
    accent: '#8b5cf6',
    homepage: 'https://leanctx.com/docs/getting-started/',
  },
  {
    id: 'supercompress',
    name: 'SuperCompress',
    description: 'High-ratio context compressor server that merges selective-context-style compression.',
    mode: 'server',
    executables: ['supercompress', 'super-compress'],
    wellKnownPaths: {
      win32: ['%LOCALAPPDATA%\\supercompress\\supercompress.exe', '~\\AppData\\Roaming\\npm\\supercompress.cmd'],
      darwin: ['/usr/local/bin/supercompress', '/opt/homebrew/bin/supercompress', '~/.local/bin/supercompress'],
      linux: ['/usr/local/bin/supercompress', '~/.local/bin/supercompress'],
    },
    detectCommand: 'supercompress --version',
    defaultPort: 8101,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'pip install supercompress (or follow vendor docs)',
    accent: '#2dd4bf',
    homepage: 'https://github.com',
  },
  {
    id: 'selective-ctx',
    name: 'Selective Context',
    description: 'Selective-Ctx — layer-selective context compression for LLMs.',
    mode: 'server',
    executables: ['selective-ctx', 'selective_ctx'],
    wellKnownPaths: {
      win32: ['~\\AppData\\Roaming\\Python\\Scripts\\selective-ctx.exe'],
      darwin: ['/usr/local/bin/selective-ctx', '/opt/homebrew/bin/selective-ctx', '~/.local/bin/selective-ctx'],
      linux: ['/usr/local/bin/selective-ctx', '~/.local/bin/selective-ctx'],
    },
    detectCommand: 'selective-ctx --version',
    defaultPort: 8102,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'pip install selective-context (See https://github.com/liyucheng09/Selective_Context)',
    accent: '#a3e635',
    homepage: 'https://github.com/liyucheng09/Selective_Context',
  },
  {
    id: 'squeez',
    name: 'Squeez',
    description: 'SqueezeLLM-style KV/context squeezer exposed as a local compression proxy.',
    mode: 'server',
    executables: ['squeez', 'squeez-proxy'],
    wellKnownPaths: {
      win32: ['~\\AppData\\Roaming\\Python\\Scripts\\squeez.exe', '%LOCALAPPDATA%\\npm\\squeez.cmd'],
      darwin: ['/usr/local/bin/squeez', '/opt/homebrew/bin/squeez', '~/.local/bin/squeez'],
      linux: ['/usr/local/bin/squeez', '~/.local/bin/squeez'],
    },
    detectCommand: 'squeez --version',
    defaultPort: 8103,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'pip install squeez (or follow vendor docs)',
    accent: '#f472b6',
    homepage: 'https://github.com',
  },
  {
    id: 'omni-route',
    name: 'OmniRoute',
    description: 'Local OpenAI-compatible routing/compression gateway for agent traffic.',
    mode: 'server',
    executables: ['omni-route', 'omniroute'],
    wellKnownPaths: {
      win32: ['%LOCALAPPDATA%\\omni-route\\omni-route.exe', '~\\AppData\\Roaming\\npm\\omni-route.cmd'],
      darwin: ['/usr/local/bin/omni-route', '/opt/homebrew/bin/omni-route', '~/.local/bin/omni-route'],
      linux: ['/usr/local/bin/omni-route', '~/.local/bin/omni-route'],
    },
    detectCommand: 'omni-route --version',
    defaultPort: 8104,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'No verified npm/pip/brew package — see the project docs (https://github.com)',
    accent: '#fb923c',
    homepage: 'https://github.com',
  },
  {
    id: 'graphify',
    name: 'Graphify',
    description: 'Graph-based context compression proxy that prunes tokenised context.',
    mode: 'server',
    executables: ['graphify', 'graphify-proxy'],
    wellKnownPaths: {
      win32: ['%LOCALAPPDATA%\\graphify\\graphify.exe', '~\\AppData\\Roaming\\npm\\graphify.cmd'],
      darwin: ['/usr/local/bin/graphify', '/opt/homebrew/bin/graphify', '~/.local/bin/graphify'],
      linux: ['/usr/local/bin/graphify', '~/.local/bin/graphify'],
    },
    detectCommand: 'graphify --version',
    defaultPort: 8105,
    defaultFlags: {},
    buildStartArgs: (port, flags) => {
      const args = ['--port', String(port)];
      if (flags.extraArgs) args.push(...flags.extraArgs.split(/\s+/));
      return args;
    },
    envStyle: 'both',
    installInstructions: 'npm install -g graphify (or follow vendor docs)',
    accent: '#e879f9',
    homepage: 'https://github.com',
  },
  {
    id: 'ponytail',
    name: 'Ponytail',
    description: 'Shell-level output/service compressor that wraps agent commands.',
    mode: 'wrapper',
    executables: ['ponytail'],
    wellKnownPaths: {
      win32: ['~\\AppData\\Roaming\\npm\\ponytail.cmd', '%LOCALAPPDATA%\\npx\\ponytail.cmd'],
      darwin: ['/usr/local/bin/ponytail', '/opt/homebrew/bin/ponytail', '~/.local/bin/ponytail'],
      linux: ['/usr/local/bin/ponytail', '~/.local/bin/ponytail'],
    },
    detectCommand: 'ponytail --version',
    defaultPort: 0,
    defaultFlags: {},
    buildStartArgs: () => [],
    envStyle: 'none',
    installInstructions: 'npm install -g ponytail (or follow vendor docs)',
    accent: '#fbbf24',
    homepage: 'https://github.com',
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
