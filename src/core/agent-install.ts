/**
 * Agent install option catalog — multi-method install per OS, same pattern as
 * compressors. Prefer durable PATH installs over ephemeral npx.
 */
import type { PlatformName } from '../shared/types';

export interface AgentInstallOption {
  id: string;
  label: string;
  command: string;
  note?: string;
}

type PlatformMap = Partial<Record<PlatformName, AgentInstallOption[]>> & {
  default?: AgentInstallOption[];
};

const CATALOG: Record<string, PlatformMap> = {
  claude: {
    default: [
      { id: 'native', label: 'Official installer', command: 'curl -fsSL https://claude.ai/install.sh | bash', note: 'Installs to ~/.claude/local' },
      { id: 'npm', label: 'npm global', command: 'npm install -g @anthropic-ai/claude-code' },
    ],
    win32: [
      { id: 'ps1', label: 'PowerShell installer', command: 'powershell -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"' },
      { id: 'npm', label: 'npm global', command: 'npm install -g @anthropic-ai/claude-code' },
    ],
  },
  codex: {
    default: [
      { id: 'npm', label: 'npm global (recommended)', command: 'npm install -g @openai/codex' },
      { id: 'npx', label: 'npx (ephemeral)', command: 'npx -y @openai/codex --version', note: 'Does not leave a permanent binary — prefer npm -g' },
    ],
  },
  cline: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g cline' },
      { id: 'npx', label: 'npx (ephemeral)', command: 'npx -y cline --version', note: 'Prefer npm -g for PATH detection' },
    ],
  },
  aider: {
    default: [
      { id: 'pipx', label: 'pipx (recommended)', command: 'pipx install aider-chat' },
      { id: 'pip', label: 'pip', command: 'pip3 install aider-chat || python3 -m pip install aider-chat || py -m pip install aider-chat' },
    ],
  },
  continue: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @continuedev/cli' },
    ],
  },
  cursor: {
    default: [
      { id: 'docs', label: 'Desktop app', command: 'open https://cursor.com || xdg-open https://cursor.com || start https://cursor.com', note: 'Cursor is a GUI IDE — install from cursor.com' },
      { id: 'cli', label: 'Cursor agent CLI', command: 'curl https://cursor.com/install -fsS | bash', note: 'Installs cursor-agent when available' },
    ],
  },
  gemini: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @google/gemini-cli' },
      { id: 'npx', label: 'npx (ephemeral)', command: 'npx -y @google/gemini-cli --version' },
    ],
  },
  grok: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @xai/grok-cli || npm install -g grok' },
    ],
  },
  'grok-build': {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @xai/grok-cli || npm install -g grok' },
    ],
  },
  goose: {
    default: [
      { id: 'curl', label: 'Official installer', command: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash', note: 'Installs goose CLI' },
      { id: 'brew', label: 'Homebrew', command: 'brew install block-goose' },
    ],
    win32: [
      { id: 'docs', label: 'Download page', command: 'start https://block.github.io/goose/ || open https://block.github.io/goose/', note: 'Install Goose from the project docs' },
    ],
  },
  opencode: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g opencode-ai' },
      { id: 'curl', label: 'Install script', command: 'curl -fsSL https://opencode.ai/install | bash' },
    ],
  },
  copilot: {
    default: [
      { id: 'gh', label: 'GitHub CLI extension', command: 'gh extension install github/gh-copilot', note: 'Requires gh auth' },
      { id: 'npm', label: 'npm global', command: 'npm install -g @github/copilot' },
    ],
  },
  openhands: {
    default: [
      { id: 'pip', label: 'pip', command: 'pip3 install openhands || python3 -m pip install openhands || py -m pip install openhands' },
      { id: 'pipx', label: 'pipx', command: 'pipx install openhands' },
    ],
  },
  'pi-coding': {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @mariozechner/pi-coding-agent || npm install -g pi-coding-agent' },
    ],
  },
  kimi: {
    default: [
      { id: 'npm', label: 'npm global', command: 'npm install -g @moonshotai/kimi-cli || npm install -g kimi-cli' },
    ],
  },
  windsurf: {
    default: [
      { id: 'docs', label: 'Download Windsurf', command: 'open https://windsurf.com || xdg-open https://windsurf.com || start https://windsurf.com', note: 'GUI IDE — install from windsurf.com' },
    ],
  },
};

/** Install options for an agent on a platform. */
export function getAgentInstallOptions(agentId: string, platform: PlatformName): AgentInstallOption[] {
  const entry = CATALOG[agentId];
  if (!entry) {
    return [
      { id: 'npm', label: 'npm global (generic)', command: `npm install -g ${agentId}` },
    ];
  }
  const specific = entry[platform];
  if (specific && specific.length > 0) return specific.map((o) => ({ ...o }));
  if (entry.default && entry.default.length > 0) return entry.default.map((o) => ({ ...o }));
  return [];
}

/** Preferred (first) install command. */
export function pickPreferredAgentInstallCommand(agentId: string, platform: PlatformName): string {
  return getAgentInstallOptions(agentId, platform)[0]?.command ?? '';
}
