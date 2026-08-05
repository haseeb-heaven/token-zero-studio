/**
 * Multi-option install commands for token compressors, per platform.
 *
 * Each compressor exposes one or more install options (uv, pip, brew, curl,
 * npm, …). The UI can present them when several exist; the installer picks the
 * first as the preferred automatic choice and can fall back through the rest.
 */

import type { PlatformName } from '../shared/types';

/** A single install recipe the user (or auto-installer) can run. */
export interface ProxyInstallOption {
  /** Stable id within the compressor, e.g. 'uv', 'pip', 'brew'. */
  id: string;
  /** Short human label shown in the UI. */
  label: string;
  /** Shell command to execute. */
  command: string;
  /** Optional note (e.g. "recommended", "adds ~/.local/bin"). */
  note?: string;
}

type PlatformMap = Partial<Record<PlatformName, ProxyInstallOption[]>> & {
  /** Fallback used when a platform-specific list is missing. */
  default?: ProxyInstallOption[];
};

const CATALOG: Record<string, PlatformMap> = {
  headroom: {
    darwin: [
      { id: 'uv', label: 'uv tool (recommended)', command: 'uv tool install --python 3.13 "headroom-ai[all]" || uv tool install "headroom-ai[all]"', note: 'Installs CLI into ~/.local/bin' },
      { id: 'pip', label: 'pip', command: 'pip3 install "headroom-ai[all]" || python3 -m pip install "headroom-ai[all]"' },
      { id: 'pipx', label: 'pipx', command: 'pipx install --python python3.13 "headroom-ai[all]" || pipx install "headroom-ai[all]"' },
    ],
    linux: [
      { id: 'uv', label: 'uv tool (recommended)', command: 'uv tool install --python 3.13 "headroom-ai[all]" || uv tool install "headroom-ai[all]"', note: 'Installs CLI into ~/.local/bin' },
      { id: 'pip', label: 'pip', command: 'pip3 install "headroom-ai[all]" || python3 -m pip install "headroom-ai[all]"' },
      { id: 'pipx', label: 'pipx', command: 'pipx install --python python3.13 "headroom-ai[all]" || pipx install "headroom-ai[all]"' },
    ],
    win32: [
      { id: 'uv', label: 'uv tool (recommended)', command: 'uv tool install --python 3.13 "headroom-ai[all]" || uv tool install "headroom-ai[all]"' },
      { id: 'pip', label: 'pip', command: 'py -m pip install "headroom-ai[all]" || python -m pip install "headroom-ai[all]"' },
      { id: 'pipx', label: 'pipx', command: 'pipx install "headroom-ai[all]"' },
    ],
  },
  pxpipe: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g pxpipe' },
      { id: 'npx', label: 'npx (no install)', command: 'npx --yes pxpipe-proxy --help', note: 'Ephemeral; prefer npm -g for PATH detection' },
    ],
  },
  rtk: {
    darwin: [
      { id: 'brew', label: 'Homebrew (recommended)', command: 'brew install rtk-ai/tap/rtk', note: 'Correct tap — not the unrelated "rtk" formula' },
      { id: 'curl', label: 'Install script', command: 'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh', note: 'Installs to ~/.local/bin' },
      { id: 'cargo', label: 'Cargo (from git)', command: 'cargo install --git https://github.com/rtk-ai/rtk --branch master rtk' },
    ],
    linux: [
      { id: 'curl', label: 'Install script (recommended)', command: 'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh', note: 'Installs to ~/.local/bin' },
      { id: 'brew', label: 'Homebrew', command: 'brew install rtk-ai/tap/rtk' },
      { id: 'cargo', label: 'Cargo (from git)', command: 'cargo install --git https://github.com/rtk-ai/rtk --branch master rtk' },
    ],
    win32: [
      { id: 'ps1', label: 'PowerShell installer', command: 'powershell -NoProfile -Command "iwr -useb https://raw.githubusercontent.com/rtk-ai/rtk/master/install.ps1 | iex"' },
      { id: 'cargo', label: 'Cargo (from git)', command: 'cargo install --git https://github.com/rtk-ai/rtk --branch master rtk' },
    ],
  },
  llmlingua: {
    darwin: [
      { id: 'pip', label: 'pip', command: 'pip3 install llmlingua || python3 -m pip install llmlingua' },
      { id: 'pipx', label: 'pipx', command: 'pipx install llmlingua' },
    ],
    linux: [
      { id: 'pip', label: 'pip', command: 'pip3 install llmlingua || python3 -m pip install llmlingua' },
      { id: 'pipx', label: 'pipx', command: 'pipx install llmlingua' },
    ],
    win32: [
      { id: 'pip', label: 'pip', command: 'py -m pip install llmlingua || python -m pip install llmlingua' },
    ],
  },
  tokenshift: {
    darwin: [
      { id: 'curl', label: 'Install script', command: 'curl -fsSL https://www.pointfive.co/tokenshift/install.sh | sh' },
    ],
    linux: [
      { id: 'curl', label: 'Install script', command: 'curl -fsSL https://www.pointfive.co/tokenshift/install.sh | sh' },
    ],
    win32: [
      { id: 'ps1', label: 'PowerShell installer', command: 'powershell -NoProfile -Command "curl -fsSL https://www.pointfive.co/tokenshift/install.ps1 | iex"' },
    ],
  },
  caveman: {
    darwin: [
      { id: 'npm', label: 'npm global', command: 'npm install -g caveman || npm install -g @caveman/cli' },
      { id: 'npx', label: 'npx from GitHub', command: 'npx -y github:JuliusBrussee/caveman', note: 'Ephemeral run; prefer npm -g for detection' },
    ],
    linux: [
      { id: 'npm', label: 'npm global', command: 'npm install -g caveman || npm install -g @caveman/cli' },
      { id: 'npx', label: 'npx from GitHub', command: 'npx -y github:JuliusBrussee/caveman', note: 'Ephemeral run; prefer npm -g for detection' },
    ],
    win32: [
      { id: 'ps1', label: 'PowerShell installer', command: 'powershell -NoProfile -Command "irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex"' },
      { id: 'npm', label: 'npm global', command: 'npm install -g caveman' },
    ],
  },
  leanctx: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g lean-ctx' },
      { id: 'pip', label: 'pip', command: 'pip3 install leanctx || python3 -m pip install leanctx || py -m pip install leanctx' },
    ],
  },
  supercompress: {
    default: [
      { id: 'pip', label: 'pip', command: 'pip3 install supercompress || python3 -m pip install supercompress || py -m pip install supercompress' },
      { id: 'npm', label: 'npm global', command: 'npm install -g supercompress' },
    ],
  },
  'selective-ctx': {
    default: [
      { id: 'pip', label: 'pip', command: 'pip3 install selective-context || python3 -m pip install selective-context || py -m pip install selective-context' },
    ],
  },
  squeez: {
    default: [
      { id: 'pip', label: 'pip', command: 'pip3 install squeez || python3 -m pip install squeez || py -m pip install squeez' },
      { id: 'npm', label: 'npm global', command: 'npm install -g squeez' },
    ],
  },
  'omni-route': {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g omni-route' },
    ],
  },
  graphify: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g graphify' },
    ],
  },
  ponytail: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g ponytail' },
    ],
  },
};

/** All install options for a compressor on a platform (never empty when known). */
export function getProxyInstallOptions(proxyId: string, platform: PlatformName): ProxyInstallOption[] {
  const entry = CATALOG[proxyId];
  if (!entry) return [];
  const specific = entry[platform];
  if (specific && specific.length > 0) return specific.map((o) => ({ ...o }));
  if (entry.default && entry.default.length > 0) return entry.default.map((o) => ({ ...o }));
  return [];
}

/** Preferred (first) install command, or empty string when none. */
export function pickPreferredInstallCommand(proxyId: string, platform: PlatformName): string {
  return getProxyInstallOptions(proxyId, platform)[0]?.command ?? '';
}

/** Shell + flag used to run an install command on the platform. */
export function resolveInstallShell(platform: PlatformName): { shell: string; flag: string } {
  if (platform === 'win32') return { shell: 'cmd.exe', flag: '/c' };
  return { shell: '/bin/sh', flag: '-c' };
}
