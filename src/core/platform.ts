import type { PlatformName } from '../shared/types';

/** Injectable environment surface so core logic stays unit-testable. */
export interface PlatformContext {
  platform: PlatformName;
  homeDir: string;
  /** process.env snapshot (PATH, PATHEXT, APPDATA, LOCALAPPDATA, ...). */
  env: Record<string, string | undefined>;
  /** File-exists probe; injectable for tests. */
  exists: (p: string) => boolean;
  /** True when the path is a file (not a directory); injectable for tests. */
  isFile: (p: string) => boolean;
  /** Directory listing probe; injectable for tests. */
  readdir: (p: string) => string[];
  /** System command execution probe (where.exe / which); injectable for tests. */
  execCommand?: (cmd: string) => string;
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
  const fs = require('fs');
  const child_process = require('child_process');
  return {
    platform: process.platform as PlatformName,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
    env: process.env,
    exists,
    isFile: (p: string): boolean => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    readdir: (p: string): string[] => {
      try {
        return fs.readdirSync(p, { withFileTypes: true }) as unknown as string[];
      } catch {
        return [];
      }
    },
    execCommand: (cmd: string): string => {
      try {
        return child_process.execSync(cmd, {
          encoding: 'utf8',
          timeout: 2500,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return '';
      }
    },
  };
}

/**
 * Common directories to search when an agent is not on PATH.
 * These are searched on every drive on Windows, or at the filesystem root on
 * macOS/Linux.
 */
export function commonSearchDirs(platform: PlatformName): string[] {
  if (platform === 'win32') {
    return [
      'Program Files',
      'Program Files (x86)',
      'Tools',
      'bin',
      'local',
      '.local\\bin',
      'scoop\\apps',
      'Users\\Public\\bin',
    ];
  }
  return ['/usr/local/bin', '/opt', '/usr/bin', '/snap/bin'];
}

/**
 * Enumerate available drives on Windows (C:\, D:\, ...).
 * On macOS/Linux returns a single-root list.
 */
export function enumerateDrives(platform: PlatformName, exists: (p: string) => boolean): string[] {
  if (platform === 'win32') {
    const drives: string[] = [];
    for (let i = 0; i < 26; i++) {
      const drive = String.fromCharCode(65 + i) + ':\\';
      if (exists(drive)) drives.push(drive);
    }
    return drives;
  }
  return ['/'];
}
