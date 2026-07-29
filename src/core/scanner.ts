import type { AgentDefinition, ScanResult } from '../shared/types';
import {
  PlatformContext,
  exeNames,
  expandPath,
  joinPath,
  normalizeForCompare,
  splitPathEnv,
} from './platform';

/**
 * Search every directory on PATH for the agent's executables.
 * Returns verified absolute paths in PATH order.
 */
export function scanPathVariable(agent: AgentDefinition, ctx: PlatformContext): string[] {
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? ctx.env.path ?? '';
  const dirs = splitPathEnv(pathValue, ctx.platform);
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const exe of agent.executables) {
      for (const name of exeNames(exe, ctx.platform)) {
        const candidate = joinPath(ctx.platform, dir, name);
        if (ctx.exists(candidate)) {
          hits.push(candidate);
          break; // one hit per exe name per dir is enough
        }
      }
    }
  }
  return dedupe(hits, ctx.platform);
}

/** Probe the agent's well-known install locations for the current platform. */
export function scanWellKnown(agent: AgentDefinition, ctx: PlatformContext): string[] {
  const locations = agent.wellKnownPaths[ctx.platform] ?? [];
  const hits: string[] = [];
  for (const loc of locations) {
    const expanded = expandPath(loc, ctx);
    if (ctx.exists(expanded)) {
      hits.push(expanded);
    }
  }
  return dedupe(hits, ctx.platform);
}

/**
 * Full detection pass for one agent: explicit path (if given) wins, then PATH,
 * then well-known locations. Never throws — a missing agent is a normal case.
 */
export function scanAgent(
  agent: AgentDefinition,
  ctx: PlatformContext,
  explicitPath?: string,
): ScanResult {
  if (explicitPath && explicitPath.trim().length > 0) {
    const expanded = expandPath(explicitPath.trim(), ctx);
    if (ctx.exists(expanded)) {
      return { agentId: agent.id, found: true, paths: [expanded], source: 'explicit' };
    }
    // Explicit path was configured but no longer exists — fall through to auto
    // detection so the user still gets a working suggestion.
  }

  const pathHits = scanPathVariable(agent, ctx);
  const wellKnownHits = scanWellKnown(agent, ctx);
  const all = dedupe([...pathHits, ...wellKnownHits], ctx.platform);

  if (all.length === 0) {
    return { agentId: agent.id, found: false, paths: [], source: 'none' };
  }
  return {
    agentId: agent.id,
    found: true,
    paths: all,
    source: pathHits.length > 0 ? 'path' : 'well-known',
  };
}

/** Verify a user-supplied explicit path (browse button) before accepting it. */
export function verifyExplicitPath(p: string, ctx: PlatformContext): boolean {
  if (!p || p.trim().length === 0) return false;
  return ctx.exists(expandPath(p.trim(), ctx));
}

function dedupe(paths: string[], platform: PlatformContext['platform']): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = normalizeForCompare(p, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
