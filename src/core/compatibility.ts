import type { AgentDefinition, CompatibilityRule, DetectionStatus, ScanResult } from '../shared/types';
import type { ProxyEnvStyle, ProxyDefinition } from './proxies/types';

/**
 * Compatibility model between token compressors and coding agents (Issue #3).
 *
 * Wrapper compressors (RTK, Caveman, Ponytail) rewrite shell commands/output,
 * so they only make sense for terminal-style agents. Server compressors inject
 * `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`, so the agent must be able to read at
 * least one of those environment variables. Explicit rules below override the
 * default heuristic for specific pairs.
 */

/**
 * Explicit overrides keyed by compressor id. Each entry lists agent ids the
 * compressor is compatible with ('*' = all). A compressor that appears here is
 * judged ONLY by this list; a compressor not present falls back to the default
 * env-style + interface heuristic.
 */
export const COMPATIBILITY: CompatibilityRule[] = [
  // These shell wrappers work with any terminal / IDE agent.
  { compressorId: 'rtk', agentIds: ['*'] },
  { compressorId: 'caveman', agentIds: ['*'] },
  { compressorId: 'ponytail', agentIds: ['*'] },
];

/** True when a compressor is compatible with an agent. */
export function isCompatible(
  def: { id: string; mode?: string; envStyle?: ProxyEnvStyle },
  agent: AgentDefinition,
): boolean {
  // Shell-level (wrapper) compressors can never drive a GUI agent, regardless
  // of any compatibility rule — a command wrapper has no way to embed into a GUI.
  if (def.mode !== 'server' && agent.interfaceType === 'gui') return false;

  // 1) Explicit rule wins when present.
  const rule = COMPATIBILITY.find((r) => r.compressorId === def.id);
  if (rule) {
    return rule.agentIds.includes('*') || rule.agentIds.includes(agent.id);
  }

  // 2) Wrapper (shell-level) compressors cannot drive GUI agents.
  if (def.mode !== 'server') {
    return agent.interfaceType !== 'gui';
  }

  // 3) Server compressors inject base URLs; the agent must read at least one.
  const injects = (def.envStyle ?? 'both') !== 'none';
  if (!injects) return false;
  return agent.envStyle !== 'none';
}

/** Resolve the set of agent ids compatible with a compressor. */
export function compatibleAgentIds(
  _compressorId: string,
  def: { id: string; mode?: string; envStyle?: ProxyEnvStyle } | undefined,
  agents: AgentDefinition[],
): string[] {
  const d = def ?? { id: _compressorId };
  return agents.filter((a) => isCompatible(d, a)).map((a) => a.id);
}

/** Resolve the set of compressor ids compatible with an agent. */
export function compatibleCompressorIds(
  agent: AgentDefinition,
  compressors: Array<{ id: string; mode?: string; envStyle?: ProxyEnvStyle }>,
): string[] {
  return compressors.filter((c) => isCompatible(c, agent)).map((c) => c.id);
}

/**
 * Derive a machine-readable detection status from a scan result combined with
 * an optional manually-configured explicit path.
 */
export function detectionStatus(
  scan: ScanResult | undefined,
  explicitPath?: string,
): DetectionStatus {
  const configured = !!explicitPath && explicitPath.trim().length > 0;
  if (configured && !scan?.found) return 'invalid-path';
  if (configured && scan?.found) return 'manually-configured';
  if (scan?.found) return 'installed';
  return 'not-found';
}

/* Re-export for convenient typing as a proxy definition helper. */
export type { ProxyDefinition };

