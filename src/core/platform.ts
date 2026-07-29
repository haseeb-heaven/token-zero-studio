import type { PlatformName } from '../shared/types';

/** Injectable environment surface so core logic stays unit-testable. */
export interface PlatformContext {
  platform: PlatformName;
  homeDir: string;
  /** process.env snapshot (PATH, PATHEXT, APPDATA, LOCALAPPDATA, ...). */
  env: Record<string, string | undefined>;
  /** File-exists probe; injectable for tests. */
  exists: (p: string) => boolean;
}

/** PATH list separator for the platform. */
export function pathSeparator(platform: PlatformName): string {
  return platform === 'win32' ? ';' : ':';
}

/** Split a PATH-style string into trimmed, non-empty, de-duplicated entries. */
export function splitPathEnv(value: string, platform: PlatformName): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(pathSeparator(platform))) {
    const entry = raw.trim().replace(/^"+|"+$/g, '');
    if (!entry) continue;
    const key = platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Executable suffixes tried on Windows (in priority order). */
export const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];

/**
 * Candidate file names for a binary on the given platform.
 * On Windows, appends PATHEXT-style suffixes unless the name already has one.
 */
export function exeNames(base: string, platform: PlatformName): string[] {
  if (platform !== 'win32') return [base];
  if (/\.(exe|cmd|bat|ps1)$/i.test(base)) return [base];
  return [...WINDOWS_EXTS.map((ext) => base + ext), base];
}

/** Expand a leading '~' and %VAR% / $VAR environment references. */
export function expandPath(p: string, ctx: Pick<PlatformContext, 'homeDir' | 'env' | 'platform'>): string {
  let out = p;
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = ctx.homeDir + out.slice(1);
  }
  // Windows %VAR% expansion
  out = out.replace(/%([^%]+)%/g, (m, name: string) => ctx.env[name] ?? m);
  // POSIX $VAR and ${VAR} expansion
  out = out.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, br: string, plain: string) => {
    const name = br ?? plain;
    return ctx.env[name] ?? m;
  });
  return out;
}

/** Join path segments with the platform separator. */
export function joinPath(platform: PlatformName, ...parts: string[]): string {
  const sep = platform === 'win32' ? '\\' : '/';
  return parts
    .filter((part) => part.length > 0)
    .map((part, i) => {
      let s = part;
      if (i > 0) s = s.replace(/^[\\/]+/, '');
      if (i < parts.length - 1) s = s.replace(/[\\/]+$/, '');
      return s;
    })
    .join(sep);
}

/** Normalise for de-duplication comparison (case-insensitive on Windows). */
export function normalizeForCompare(p: string, platform: PlatformName): string {
  const unified = p.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? unified.toLowerCase() : unified;
}

/** Current platform context built from real Node values. */
export function currentPlatformContext(exists: (p: string) => boolean): PlatformContext {
  return {
    platform: process.platform as PlatformName,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
    env: process.env,
    exists,
  };
}
