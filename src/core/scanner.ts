import type { AgentDefinition, ScanResult } from '../shared/types';
import {
  PlatformContext,
  commonSearchDirs,
  enumerateDrives,
  exeNames,
  expandPath,
  joinPath,
  mergePathWithUserBins,
  normalizeForCompare,
  splitPathEnv,
} from './platform';

/**
 * Search every directory on PATH for the agent's executables.
 * Returns verified absolute paths in PATH order.
 * Also probes user-level bin dirs (pip/uv/npm/cargo) that Electron's PATH
 * often omits after a fresh install.
 */
export function scanPathVariable(agent: AgentDefinition, ctx: PlatformContext): string[] {
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? ctx.env.path ?? '';
  const merged = mergePathWithUserBins(pathValue, ctx.platform, ctx.homeDir);
  const dirs = splitPathEnv(merged, ctx.platform);
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
 * Probe OS system resolution utilities (`where.exe` on Windows, `which` on macOS/Linux).
 * Returns verified absolute executable paths.
 */
export function scanSystemCommand(agent: AgentDefinition, ctx: PlatformContext): string[] {
  if (!ctx.execCommand) return [];
  const hits: string[] = [];

  for (const exe of agent.executables) {
    if (ctx.platform === 'win32') {
      const output = ctx.execCommand(`where.exe ${exe}`);
      if (output) {
        for (const line of output.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && ctx.exists(trimmed)) {
            hits.push(trimmed);
          }
        }
      }
    } else {
      const output = ctx.execCommand(`which -a ${exe} 2>/dev/null || which ${exe} 2>/dev/null`);
      if (output) {
        for (const line of output.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && ctx.exists(trimmed)) {
            hits.push(trimmed);
          }
        }
      }
    }
  }

  return dedupe(hits, ctx.platform);
}

/**
 * Full detection pass for one agent: explicit path (if given) wins, then PATH,
 * then system commands (where/which), then well-known locations. Never throws.
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
    // Explicit path was configured but no longer exists - fall through to auto
    // detection so the user still gets a working suggestion.
  }

  const pathHits = scanPathVariable(agent, ctx);
  const sysHits = scanSystemCommand(agent, ctx);
  const wellKnownHits = scanWellKnown(agent, ctx);
  const driveHits = scanDriveDirectories(agent, ctx);
  const all = dedupe([...pathHits, ...sysHits, ...wellKnownHits, ...driveHits], ctx.platform);

  if (all.length === 0) {
    return { agentId: agent.id, found: false, paths: [], source: 'none' };
  }
  if (pathHits.length > 0 || sysHits.length > 0) return { agentId: agent.id, found: true, paths: all, source: 'path' };
  if (wellKnownHits.length > 0) return { agentId: agent.id, found: true, paths: all, source: 'well-known' };
  return { agentId: agent.id, found: true, paths: all, source: 'drive' };
}

/** Verify a user-supplied explicit path (browse button) before accepting it. */
export function verifyExplicitPath(p: string, ctx: PlatformContext): boolean {
  if (!p || p.trim().length === 0) return false;
  return ctx.exists(expandPath(p.trim(), ctx));
}

/**
 * Search common directories on every drive (e.g. Program Files, /opt, /usr/local).
 * This catches agents installed outside of PATH.
 */
export function scanDriveDirectories(agent: AgentDefinition, ctx: PlatformContext): string[] {
  const hits: string[] = [];
  const dirs = commonSearchDirs(ctx.platform);
  const drives = enumerateDrives(ctx.platform, ctx.exists);
  for (const drive of drives) {
    for (const dir of dirs) {
      const base = joinPath(ctx.platform, drive, dir);
      if (!ctx.exists(base)) continue;
      // Search the directory itself and one level of subdirectories.
      const subdirs = scanSubdirs(base, ctx);
      for (const searchDir of [base, ...subdirs]) {
        for (const exe of agent.executables) {
          for (const name of exeNames(exe, ctx.platform)) {
            const candidate = joinPath(ctx.platform, searchDir, name);
            if (ctx.exists(candidate) && ctx.isFile(candidate)) {
              hits.push(candidate);
              break;
            }
          }
        }
      }
    }
  }
  return dedupe(hits, ctx.platform);
}

/** List immediate subdirectories of a path (non-recursive). */
function scanSubdirs(dir: string, ctx: PlatformContext): string[] {
  try {
    const entries = ctx.readdir(dir);
    return entries
      .filter((e) => typeof e === 'string')
      .map((e) => joinPath(ctx.platform, dir, e as string));
  } catch {
    return [];
  }
}

/**
 * Optional deep scan: recursively search a limited set of root directories for
 * the agent binary. Use sparingly - this is slower than PATH/well-known/drive
 * scans. Returns at most `maxResults` hits.
 */
export function scanDeep(
  agent: AgentDefinition,
  ctx: PlatformContext,
  opts: { maxDepth?: number; maxResults?: number } = {},
): string[] {
  const maxDepth = opts.maxDepth ?? 3;
  const maxResults = opts.maxResults ?? 10;
  const roots = enumerateDrives(ctx.platform, ctx.exists);
  const hits: string[] = [];
  const visited = new Set<string>();

  const search = (dir: string, depth: number) => {
    if (hits.length >= maxResults || depth > maxDepth) return;
    const key = normalizeForCompare(dir, ctx.platform);
    if (visited.has(key)) return;
    visited.add(key);

    for (const exe of agent.executables) {
      for (const name of exeNames(exe, ctx.platform)) {
        const candidate = joinPath(ctx.platform, dir, name);
        if (ctx.exists(candidate) && ctx.isFile(candidate)) {
          hits.push(candidate);
          if (hits.length >= maxResults) return;
        }
      }
    }

    if (depth < maxDepth) {
      try {
        const entries = ctx.readdir(dir);
        for (const entry of entries) {
          search(joinPath(ctx.platform, dir, entry), depth + 1);
        }
      } catch {
        /* permission denied or not a directory - skip */
      }
    }
  };

  for (const root of roots) {
    search(root, 0);
  }
  return dedupe(hits, ctx.platform);
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
