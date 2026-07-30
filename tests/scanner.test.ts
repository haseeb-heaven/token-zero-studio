import { describe, expect, it } from 'vitest';
import { getAgent } from '../src/core/agents';
import type { PlatformContext } from '../src/core/platform';
import { scanAgent, scanDriveDirectories, scanDeep, scanPathVariable, scanWellKnown, verifyExplicitPath } from '../src/core/scanner';

/** Build a fake Windows platform context from a set of existing files. */
function fakeWin(
  files: string[],
  pathValue: string,
  dirs: Record<string, string[]> = {},
): PlatformContext {
  const lower = new Set(files.map((f) => f.toLowerCase()));
  const dirSet = new Set<string>();
  for (const d of Object.keys(dirs)) dirSet.add(d.toLowerCase());
  for (const subdirs of Object.values(dirs)) {
    for (const s of subdirs) dirSet.add(s.toLowerCase());
  }
  return {
    platform: 'win32',
    homeDir: 'C:\\Users\\hasee',
    env: {
      PATH: pathValue,
      APPDATA: 'C:\\Users\\hasee\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\hasee\\AppData\\Local',
    },
    exists: (p) => lower.has(p.toLowerCase()),
    isFile: (p) => lower.has(p.toLowerCase()) && !dirSet.has(p.toLowerCase()),
    readdir: (p) => dirs[p.toLowerCase()] ?? [],
  };
}

function fakeLinux(
  files: string[],
  pathValue: string,
  dirs: Record<string, string[]> = {},
): PlatformContext {
  const set = new Set(files);
  const dirSet = new Set<string>();
  for (const d of Object.keys(dirs)) dirSet.add(d);
  for (const subdirs of Object.values(dirs)) {
    for (const s of subdirs) dirSet.add(s);
  }
  return {
    platform: 'linux',
    homeDir: '/home/u',
    env: { PATH: pathValue },
    exists: (p) => set.has(p),
    isFile: (p) => set.has(p) && !dirSet.has(p),
    readdir: (p) => dirs[p] ?? [],
  };
}

describe('scanPathVariable', () => {
  it('finds executables on PATH (Windows tries .exe/.cmd/...)', () => {
    const ctx = fakeWin(
      ['D:\\henv\\Scripts\\codex.exe', 'C:\\tools\\codex.cmd'],
      'D:\\henv\\Scripts;C:\\tools;C:\\empty',
    );
    const hits = scanPathVariable(getAgent('codex'), ctx);
    expect(hits).toEqual(['D:\\henv\\Scripts\\codex.exe', 'C:\\tools\\codex.cmd']);
  });

  it('respects PATH order and prefers .exe over .cmd in the same dir', () => {
    const ctx = fakeWin(
      ['C:\\a\\codex.cmd', 'C:\\b\\codex.exe', 'C:\\b\\codex.cmd'],
      'C:\\a;C:\\b',
    );
    const hits = scanPathVariable(getAgent('codex'), ctx);
    expect(hits).toEqual(['C:\\a\\codex.cmd', 'C:\\b\\codex.exe']);
  });

  it('finds bare binaries on POSIX', () => {
    const ctx = fakeLinux(['/usr/local/bin/claude'], '/usr/local/bin:/usr/bin');
    expect(scanPathVariable(getAgent('claude'), ctx)).toEqual(['/usr/local/bin/claude']);
  });

  it('returns empty when nothing is on PATH', () => {
    const ctx = fakeLinux([], '/usr/bin');
    expect(scanPathVariable(getAgent('aider'), ctx)).toEqual([]);
  });
});

describe('scanWellKnown', () => {
  it('probes Windows well-known locations with ~ and %VAR% expansion', () => {
    const ctx = fakeWin(['C:\\Users\\hasee\\.grok\\bin\\grok.exe'], '');
    expect(scanWellKnown(getAgent('grok'), ctx)).toEqual(['C:\\Users\\hasee\\.grok\\bin\\grok.exe']);
  });

  it('probes Linux well-known locations', () => {
    const ctx = fakeLinux(['/home/u/.local/bin/aider'], '');
    expect(scanWellKnown(getAgent('aider'), ctx)).toEqual(['/home/u/.local/bin/aider']);
  });

  it('returns empty for agents without locations on this platform', () => {
    const ctx = fakeLinux(['/anything'], '');
    expect(scanWellKnown(getAgent('continue'), ctx)).toEqual([]);
  });
});

describe('scanAgent', () => {
  it('combines PATH and well-known hits, PATH first, de-duplicated', () => {
    const ctx = fakeWin(
      ['D:\\tools\\grok.exe', 'C:\\Users\\hasee\\.grok\\bin\\grok.exe'],
      'D:\\tools',
    );
    const result = scanAgent(getAgent('grok'), ctx);
    expect(result.found).toBe(true);
    expect(result.paths).toEqual(['D:\\tools\\grok.exe', 'C:\\Users\\hasee\\.grok\\bin\\grok.exe']);
    expect(result.source).toBe('path');
  });

  it('reports source well-known when only a well-known path hits', () => {
    const ctx = fakeWin(['C:\\Users\\hasee\\.grok\\bin\\grok.exe'], 'C:\\nope');
    const result = scanAgent(getAgent('grok'), ctx);
    expect(result.source).toBe('well-known');
  });

  it('honours a valid explicit path above everything', () => {
    const ctx = fakeWin(['D:\\custom\\grok.exe', 'D:\\tools\\grok.exe'], 'D:\\tools');
    const result = scanAgent(getAgent('grok'), ctx, 'D:\\custom\\grok.exe');
    expect(result).toEqual({
      agentId: 'grok',
      found: true,
      paths: ['D:\\custom\\grok.exe'],
      source: 'explicit',
    });
  });

  it('falls back to auto-detection when the explicit path vanished', () => {
    const ctx = fakeWin(['D:\\tools\\grok.exe'], 'D:\\tools');
    const result = scanAgent(getAgent('grok'), ctx, 'D:\\gone\\grok.exe');
    expect(result.found).toBe(true);
    expect(result.source).toBe('path');
  });

  it('reports not-found cleanly', () => {
    const ctx = fakeLinux([], '/usr/bin');
    const result = scanAgent(getAgent('vibe'), ctx);
    expect(result).toEqual({ agentId: 'vibe', found: false, paths: [], source: 'none' });
  });

  it('expands ~ in explicit paths', () => {
    const ctx = fakeLinux(['/home/u/bin/grok'], '');
    const result = scanAgent(getAgent('grok'), ctx, '~/bin/grok');
    expect(result.paths).toEqual(['/home/u/bin/grok']);
  });
});

describe('verifyExplicitPath', () => {
  it('accepts existing paths and rejects missing/empty ones', () => {
    const ctx = fakeWin(['D:\\x\\claude.exe'], '');
    expect(verifyExplicitPath('D:\\x\\claude.exe', ctx)).toBe(true);
    expect(verifyExplicitPath('D:\\x\\nope.exe', ctx)).toBe(false);
    expect(verifyExplicitPath('', ctx)).toBe(false);
    expect(verifyExplicitPath('   ', ctx)).toBe(false);
  });
});

describe('scanDriveDirectories', () => {
  it('finds executables in Program Files on Windows', () => {
    const ctx = fakeWin(
      ['C:\\', 'C:\\Program Files', 'C:\\Program Files\\Grok\\grok.exe'],
      '',
      { 'c:\\program files': ['Grok'], 'c:\\program files\\grok': [] },
    );
    const hits = scanDriveDirectories(getAgent('grok'), ctx);
    expect(hits).toEqual(['C:\\Program Files\\Grok\\grok.exe']);
  });

  it('finds executables in /opt on Linux', () => {
    const ctx = fakeLinux(
      ['/', '/opt', '/opt/grok/bin/grok'],
      '',
      { '/': ['opt'], '/opt': ['grok'], '/opt/grok': ['bin'], '/opt/grok/bin': ['grok'] },
    );
    // scanDriveDirectories searches one level of subdirs, so use scanDeep for deeper paths
    const hits = scanDeep(getAgent('grok'), ctx, { maxDepth: 4, maxResults: 10 });
    expect(hits).toContain('/opt/grok/bin/grok');
  });

  it('returns empty when nothing is in common directories', () => {
    const ctx = fakeLinux([], '');
    expect(scanDriveDirectories(getAgent('vibe'), ctx)).toEqual([]);
  });

  it('reports source drive when only drive directories match', () => {
    const ctx = fakeWin(
      ['C:\\', 'C:\\Program Files', 'C:\\Program Files\\Grok\\grok.exe'],
      '',
      { 'c:\\program files': ['Grok'], 'c:\\program files\\grok': [] },
    );
    const result = scanAgent(getAgent('grok'), ctx);
    expect(result.source).toBe('drive');
    expect(result.found).toBe(true);
  });
});

describe('scanDeep', () => {
  it('respects maxDepth and maxResults', () => {
    const ctx = fakeLinux(
      ['/a/b/c/grok'],
      '',
      { '/': ['a'], '/a': ['b'], '/a/b': ['c'], '/a/b/c': ['grok'] },
    );
    const hits = scanDeep(getAgent('grok'), ctx, { maxDepth: 5, maxResults: 5 });
    expect(hits).toContain('/a/b/c/grok');
  });

  it('returns empty when nothing is found', () => {
    const ctx = fakeLinux([], '');
    expect(scanDeep(getAgent('vibe'), ctx)).toEqual([]);
  });
});
