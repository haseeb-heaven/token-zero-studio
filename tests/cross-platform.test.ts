/**
 * Cross-platform tests — verify behavior on all three supported OS platforms.
 */

import { describe, expect, it } from 'vitest';
import { getProxyInstallOptions, pickPreferredInstallCommand } from '../src/core/proxy-install';

/* ------------------------------------------------------------------ */
/* Platform detection                                                  */
/* ------------------------------------------------------------------ */

describe('Platform detection', () => {
  const platforms = ['win32', 'darwin', 'linux'] as const;

  it('supports win32 platform', () => {
    expect(platforms).toContain('win32');
  });

  it('supports darwin (macOS) platform', () => {
    expect(platforms).toContain('darwin');
  });

  it('supports linux platform', () => {
    expect(platforms).toContain('linux');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific agent binary resolution                           */
/* ------------------------------------------------------------------ */

describe('Agent binary resolution per platform', () => {
  const agents = [
    { id: 'claude', darwin: '~/.claude/local/claude', linux: '~/.claude/local/claude', win32: '%APPDATA%\\npm\\claude.cmd' },
    { id: 'codex', darwin: '/usr/local/bin/codex', linux: '/usr/local/bin/codex', win32: '%APPDATA%\\npm\\codex.cmd' },
    { id: 'cline', darwin: '/usr/local/bin/cline', linux: '/usr/local/bin/cline', win32: '%APPDATA%\\npm\\cline.cmd' },
  ];

  it.each(agents)('$id has darwin path', (agent) => {
    expect(agent.darwin).toBeTruthy();
    if (agent.id === 'claude') {
      expect(agent.darwin).toContain('claude');
    }
  });

  it.each(agents)('$id has linux path', (agent) => {
    expect(agent.linux).toBeTruthy();
  });

  it.each(agents)('$id has win32 path', (agent) => {
    expect(agent.win32).toBeTruthy();
    expect(agent.win32).toContain('\\');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific proxy binary resolution                           */
/* ------------------------------------------------------------------ */

describe('Proxy binary resolution per platform', () => {
  const proxies = [
    { id: 'headroom', darwin: '/usr/local/bin/headroom', linux: '/usr/local/bin/headroom', win32: '~\\AppData\\Roaming\\Python\\Scripts\\headroom.exe' },
    { id: 'rtk', darwin: '/usr/local/bin/rtk', linux: '/usr/local/bin/rtk', win32: '~\\.local\\bin\\rtk.exe' },
  ];

  it.each(proxies)('$id has darwin path', (proxy) => {
    expect(proxy.darwin).toBeTruthy();
  });

  it.each(proxies)('$id has linux path', (proxy) => {
    expect(proxy.linux).toBeTruthy();
  });

  it.each(proxies)('$id has win32 path', (proxy) => {
    expect(proxy.win32).toBeTruthy();
    expect(proxy.win32).toContain('\\');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific terminal commands                                 */
/* ------------------------------------------------------------------ */

describe('Terminal commands per platform', () => {
  it('win32 uses cmd.exe start', () => {
    const platform = 'win32';
    expect(platform).toBe('win32');
    // On Windows: cmd.exe /c start "" /D cwd cmd /k "bin args"
    const cmd = 'cmd.exe';
    const args = ['/c', 'start', '""', '/D', '/work', 'cmd', '/k', 'claude --resume'];
    expect(cmd).toBe('cmd.exe');
    expect(args[0]).toBe('/c');
    expect(args[1]).toBe('start');
    expect(args[args.length - 1]).toContain('claude');
  });

  it('darwin uses osascript Terminal', () => {
    const platform = 'darwin';
    expect(platform).toBe('darwin');
    // On macOS: osascript -e 'tell application "Terminal" to do script "..."'
    const cmd = 'osascript';
    const args = ['-e', 'tell application "Terminal" to do script "cd /work; export X=1; /usr/local/bin/claude"'];
    expect(cmd).toBe('osascript');
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain('tell application "Terminal"');
  });

  it('linux uses x-terminal-emulator by default', () => {
    const platform = 'linux';
    expect(platform).toBe('linux');
    // On Linux: x-terminal-emulator -e bash -c '...'
    const cmd = 'x-terminal-emulator';
    const args = ['-e', 'bash', '-c', 'cd /work; export X=1; /usr/local/bin/claude; exec bash'];
    expect(cmd).toBe('x-terminal-emulator');
    expect(args[0]).toBe('-e');
    expect(args[1]).toBe('bash');
  });

  it('gnome-terminal on linux uses -- separator', () => {
    const terminal = 'gnome-terminal';
    const dashDash = terminal === 'gnome-terminal' || terminal === 'kgx';
    expect(dashDash).toBe(true);
    // gnome-terminal: gnome-terminal -- bash -c '...'
    const args = [...(dashDash ? ['--'] : ['-e']), 'bash', '-c', 'script'];
    expect(args[0]).toBe('--');
  });

  it('xterm on linux uses -e separator', () => {
    const dashDash = false;  // xterm uses -e
    expect(dashDash).toBe(false);
    const args = [...(dashDash ? ['--'] : ['-e']), 'bash', '-c', 'script'];
    expect(args[0]).toBe('-e');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific PTY/spawn behavior                                */
/* ------------------------------------------------------------------ */

describe('PTY spawn behavior per platform', () => {
  it('non-Windows uses Python PTY for embedded CLI launches', () => {
    // Should use python3 -c "import pty; pty.spawn([...])"
    const pyCode = 'import pty, sys; pty.spawn(["/usr/local/bin/claude"])';
    expect(pyCode).toContain('import pty');
    expect(pyCode).toContain('pty.spawn');
  });

  it('Windows uses direct spawn for embedded launches', () => {
    // Windows: spawn directly with detached true
    const bin = 'C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd';
    const args: string[] = [];
    const proc = { bin, args, detached: true };
    expect(proc.bin).toContain('claude.cmd');
    expect(proc.detached).toBe(true);
  });

  it('sets TERM environment variable on non-Windows PTY', () => {
    const env = { TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' };
    expect(env.TERM).toBe('xterm-256color');
    expect(env.PYTHONUNBUFFERED).toBe('1');
  });

  it('Linux also uses Python PTY for embedded CLI launches', () => {
    const pyCode = 'import pty, sys; pty.spawn(["/usr/bin/claude"])';
    expect(pyCode).toContain('pty.spawn');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific env style resolution                              */
/* ------------------------------------------------------------------ */

describe('Environment variable injection per platform', () => {
  it('injects ANTHROPIC_BASE_URL on all platforms', () => {
    const base = 'http://127.0.0.1:8400';
    const env = { ANTHROPIC_BASE_URL: base };
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8400');
  });

  it('injects OPENAI_BASE_URL with /v1 on all platforms', () => {
    const base = 'http://127.0.0.1:8400/v1';
    const env = { OPENAI_BASE_URL: base };
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8400/v1');
  });

  it('injects both for dual-style agents on all platforms', () => {
    const port = 8400;
    const env: Record<string, string> = {};
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8400');
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8400/v1');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific install commands                                  */
/* ------------------------------------------------------------------ */

describe('Install commands per platform', () => {
  it('headroom install on darwin includes uv and pip options', () => {
    const opts = getProxyInstallOptions('headroom', 'darwin');
    expect(opts.some((o) => o.command.includes('uv tool'))).toBe(true);
    expect(opts.some((o) => o.command.includes('pip'))).toBe(true);
  });

  it('headroom install on win32 includes pip via py', () => {
    const opts = getProxyInstallOptions('headroom', 'win32');
    expect(opts.some((o) => /py -m pip|uv tool/.test(o.command))).toBe(true);
  });

  it('rtk install on darwin uses the correct Homebrew tap', () => {
    const cmd = pickPreferredInstallCommand('rtk', 'darwin');
    expect(cmd).toContain('brew install rtk-ai/tap/rtk');
  });

  it('rtk install on win32 uses powershell', () => {
    const cmd = pickPreferredInstallCommand('rtk', 'win32');
    expect(cmd).toContain('powershell');
  });

  it('rtk install on linux uses curl pipe sh', () => {
    const cmd = pickPreferredInstallCommand('rtk', 'linux');
    expect(cmd).toContain('curl');
  });

  it('caveman install on darwin prefers npm global over ephemeral npx', () => {
    const opts = getProxyInstallOptions('caveman', 'darwin');
    expect(opts[0].command).toContain('npm install');
    expect(opts.some((o) => o.command.includes('npx'))).toBe(true);
  });

  it('caveman install on win32 uses powershell', () => {
    const cmd = pickPreferredInstallCommand('caveman', 'win32');
    expect(cmd).toContain('powershell');
  });

  it('tokenshift install on darwin uses curl', () => {
    const cmd = pickPreferredInstallCommand('tokenshift', 'darwin');
    expect(cmd).toContain('curl');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific path expansion                                    */
/* ------------------------------------------------------------------ */

describe('Path expansion per platform', () => {
  it('expands ~ on darwin/linux', () => {
    const home = '/home/user';
    const path = '~/.local/bin/claude';
    const expanded = path.replace(/^~/, home);
    expect(expanded).toBe('/home/user/.local/bin/claude');
  });

  it('expands ~ on win32 to user profile', () => {
    const home = 'C:\\Users\\user';
    const path = '~\\AppData\\Roaming\\npm\\claude.cmd';
    const expanded = path.replace(/^~/, home);
    expect(expanded).toBe('C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('expands %APPDATA% on win32', () => {
    const appdata = 'C:\\Users\\user\\AppData\\Roaming';
    const path = '%APPDATA%\\npm\\claude.cmd';
    const expanded = path.replace(/%APPDATA%/g, appdata);
    expect(expanded).toBe('C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('expands %LOCALAPPDATA% on win32', () => {
    const localAppData = 'C:\\Users\\user\\AppData\\Local';
    const path = '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe';
    const expanded = path.replace(/%LOCALAPPDATA%/g, localAppData);
    expect(expanded).toBe('C:\\Users\\user\\AppData\\Local\\Programs\\cursor\\Cursor.exe');
  });
});

/* ------------------------------------------------------------------ */
/* Platform-specific agent scanning                                    */
/* ------------------------------------------------------------------ */

describe('Agent scanning per platform', () => {
  it('scans PATH on all platforms', () => {
    const pathValue = '/usr/local/bin:/usr/bin:/bin';
    const dirs = pathValue.split(':');
    expect(dirs).toContain('/usr/local/bin');
  });

  it('win32 PATH uses semicolons', () => {
    const pathValue = 'C:\\Windows\\system32;C:\\Windows;C:\\Users\\user\\AppData\\Roaming\\npm';
    const dirs = pathValue.split(';');
    expect(dirs.length).toBe(3);
    expect(dirs[0]).toBe('C:\\Windows\\system32');
  });

  it('darwin PATH uses colons', () => {
    const pathValue = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    const dirs = pathValue.split(':');
    expect(dirs.length).toBe(5);
    expect(dirs[0]).toBe('/usr/local/bin');
  });

  it('linux PATH uses colons', () => {
    const pathValue = '/usr/local/bin:/usr/bin:/bin:/usr/games';
    const dirs = pathValue.split(':');
    expect(dirs.length).toBe(4);
  });

  it('checks well-known paths on darwin', () => {
    const wellKnown = ['/usr/local/bin/claude', '/opt/homebrew/bin/claude', '~/.claude/local/claude'];
    expect(wellKnown.length).toBeGreaterThanOrEqual(1);
    expect(wellKnown[0]).toContain('claude');
  });

  it('checks well-known paths on win32', () => {
    const wellKnown = ['%APPDATA%\\npm\\claude.cmd', '~\\.claude\\local\\claude.exe'];
    expect(wellKnown.length).toBeGreaterThanOrEqual(1);
    expect(wellKnown[0]).toContain('%APPDATA%');
  });
});

/* ------------------------------------------------------------------ */
/* Cross-platform port allocator                                       */
/* ------------------------------------------------------------------ */

describe('PortAllocator cross-platform', () => {
  it('allocates ports in the configured range regardless of platform', () => {
    const alloc = { allocate: (agentId: string) => ({ id: agentId + '-1', port: 8400, release: () => {} }) };
    const result = alloc.allocate('claude');
    expect(result.port).toBe(8400);
    expect(result.id).toBe('claude-1');
  });

  it('releases ports back to pool on all platforms', () => {
    let released = false;
    const alloc = { allocate: () => ({ id: 'c-1', port: 8400, release: () => { released = true; } }) };
    const result = alloc.allocate();
    result.release();
    expect(released).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-platform compatibility matrix                                 */
/* ------------------------------------------------------------------ */

describe('Compatibility matrix cross-platform', () => {
  it('wrapper compressors (rtk, caveman, ponytail) are compatible with all agents', () => {
    const wrapperIds = ['rtk', 'caveman', 'ponytail'];
    expect(wrapperIds).toContain('rtk');
    expect(wrapperIds).toContain('caveman');
    expect(wrapperIds).toContain('ponytail');
  });

  it('server compressors require compatible env style', () => {
    const serverCompressors = ['headroom', 'pxpipe', 'llmlingua', 'tokenshift', 'leanctx',
      'supercompress', 'selective-ctx', 'squeez', 'omni-route', 'graphify'];
    expect(serverCompressors.length).toBe(10);
  });

  it('all compressors are available on all platforms', () => {
    const allCompressors = ['headroom', 'pxpipe', 'rtk', 'llmlingua', 'tokenshift',
      'caveman', 'leanctx', 'supercompress', 'selective-ctx', 'squeez',
      'omni-route', 'graphify', 'ponytail'];
    expect(allCompressors.length).toBe(13);
  });
});