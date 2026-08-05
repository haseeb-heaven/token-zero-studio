import { describe, expect, it } from 'vitest';
import {
  currentPlatformContext,
  enumerateDrives,
  exeNames,
  expandPath,
  joinPath,
  normalizeForCompare,
  pathSeparator,
  splitPathEnv,
  userBinDirs,
} from '../src/core/platform';

describe('pathSeparator', () => {
  it('uses ; on Windows and : elsewhere', () => {
    expect(pathSeparator('win32')).toBe(';');
    expect(pathSeparator('darwin')).toBe(':');
    expect(pathSeparator('linux')).toBe(':');
  });
});

describe('splitPathEnv', () => {
  it('splits, trims, strips quotes and drops empties', () => {
    expect(splitPathEnv(' /a ;/b;;"c:\\x y";', 'win32')).toEqual(['/a', '/b', 'c:\\x y']);
    expect(splitPathEnv('/a:/b::/c', 'linux')).toEqual(['/a', '/b', '/c']);
  });

  it('de-duplicates (case-insensitively on Windows)', () => {
    expect(splitPathEnv('C:\\A;c:\\a;C:\\B', 'win32')).toEqual(['C:\\A', 'C:\\B']);
    expect(splitPathEnv('/a:/A:/a', 'linux')).toEqual(['/a', '/A']);
  });

  it('handles empty input', () => {
    expect(splitPathEnv('', 'linux')).toEqual([]);
  });
});

describe('exeNames', () => {
  it('returns the bare name on POSIX', () => {
    expect(exeNames('codex', 'linux')).toEqual(['codex']);
    expect(exeNames('codex', 'darwin')).toEqual(['codex']);
  });

  it('appends Windows executable extensions in priority order', () => {
    expect(exeNames('codex', 'win32')).toEqual([
      'codex.exe',
      'codex.cmd',
      'codex.bat',
      'codex.ps1',
      'codex',
    ]);
  });

  it('does not double-append when an extension is present', () => {
    expect(exeNames('grok.exe', 'win32')).toEqual(['grok.exe']);
  });
});

describe('expandPath', () => {
  const ctx = {
    platform: 'win32' as const,
    homeDir: 'C:\\Users\\test',
    env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
  };

  it('expands leading tilde', () => {
    expect(expandPath('~\\.grok\\bin\\grok.exe', ctx)).toBe('C:\\Users\\test\\.grok\\bin\\grok.exe');
    expect(expandPath('~', ctx)).toBe('C:\\Users\\test');
  });

  it('expands %VAR% references and leaves unknown vars untouched', () => {
    expect(expandPath('%APPDATA%\\npm\\codex.cmd', ctx)).toBe(
      'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd',
    );
    expect(expandPath('%UNKNOWN%\\x', ctx)).toBe('%UNKNOWN%\\x');
  });

  it('expands $VAR and ${VAR} on POSIX', () => {
    const posix = { platform: 'linux' as const, homeDir: '/home/u', env: { XDG: '/xdg' } };
    expect(expandPath('$XDG/bin', posix)).toBe('/xdg/bin');
    expect(expandPath('${XDG}/bin', posix)).toBe('/xdg/bin');
  });
});

describe('joinPath', () => {
  it('joins with the correct separator and normalises inner slashes', () => {
    expect(joinPath('win32', 'C:\\a\\', '\\b', 'c.exe')).toBe('C:\\a\\b\\c.exe');
    expect(joinPath('linux', '/a/', '/b/', 'c')).toBe('/a/b/c');
  });
});

describe('normalizeForCompare', () => {
  it('is case-insensitive and slash-agnostic on Windows', () => {
    expect(normalizeForCompare('C:\\A\\b.exe', 'win32')).toBe(normalizeForCompare('c:/a/B.exe', 'win32'));
  });
  it('keeps case on POSIX', () => {
    expect(normalizeForCompare('/A/b', 'linux')).not.toBe(normalizeForCompare('/a/b', 'linux'));
  });
});

describe('userBinDirs', () => {
  it('covers the common package-manager bin dirs on each platform', () => {
    const mac = userBinDirs('darwin', '/Users/u');
    expect(mac).toEqual(expect.arrayContaining(['/Users/u/.local/bin', '/Users/u/.cargo/bin', '/opt/homebrew/bin']));
    const win = userBinDirs('win32', 'C:\\Users\\u');
    expect(win.some((d) => d.includes('AppData') && d.includes('npm'))).toBe(true);
    const linux = userBinDirs('linux', '/home/u');
    expect(linux).toEqual(expect.arrayContaining(['/home/u/.local/bin', '/home/u/.cargo/bin', '/usr/local/bin']));
  });
});

describe('enumerateDrives', () => {
  it('returns a single root on POSIX', () => {
    expect(enumerateDrives('darwin', () => true)).toEqual(['/']);
  });
  it('enumerates existing letters on Windows', () => {
    const drives = enumerateDrives('win32', (p) => p === 'C:\\' || p === 'D:\\');
    expect(drives).toEqual(['C:\\', 'D:\\']);
  });
});

describe('currentPlatformContext', () => {
  it('builds a context that resolves the real environment', () => {
    const ctx = currentPlatformContext((p) => p === process.cwd());
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.homeDir.length).toBeGreaterThan(0);
    expect(ctx.env.PATH ?? ctx.env.Path).toBeTruthy();
    expect(ctx.exists(process.cwd())).toBe(true);
    expect(ctx.exists('/definitely/not/a/real/path')).toBe(false);
  });

  it('isFile/readdir/execCommand behave safely', () => {
    const ctx = currentPlatformContext(() => true);
    expect(typeof ctx.isFile).toBe('function');
    expect(typeof ctx.readdir).toBe('function');
    // execCommand returns '' for a failing command without throwing.
    expect(ctx.execCommand?.('__definitely_not_a_command__ 2>/dev/null')).toBe('');
  });
});
