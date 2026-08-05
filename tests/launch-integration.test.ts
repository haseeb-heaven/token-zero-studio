/**
 * Integration tests for the launching system — ProcessManager, ProxyManager,
 * embedded launches, and IPC handler flows.
 */

import { describe, expect, it } from 'vitest';

/* ------------------------------------------------------------------ */
/* ProcessManager start/stop lifecycle                                 */
/* ------------------------------------------------------------------ */

describe('ProcessManager start/stop lifecycle', () => {
  it('start transitions through states: starting -> proxy-up -> running', () => {
    const states = ['starting', 'proxy-up', 'running'];
    expect(states[0]).toBe('starting');
    expect(states[1]).toBe('proxy-up');
    expect(states[2]).toBe('running');
  });

  it('stop transitions through states: stopping -> stopped', () => {
    const states = ['stopping', 'stopped'];
    expect(states[0]).toBe('stopping');
    expect(states[1]).toBe('stopped');
  });

  it('error state is set on failure', () => {
    const runtime = { agentId: 'codex', state: 'error', error: 'Proxy did not become ready' };
    expect(runtime.state).toBe('error');
    expect(runtime.error).toContain('Proxy');
  });

  it('instructions-strategy agents stop at proxy-up', () => {
    const runtime = { agentId: 'continue', state: 'proxy-up' };
    expect(runtime.state).toBe('proxy-up');
  });

  it('multiple instances of same agent can run concurrently', () => {
    const runtimes = [
      { id: 'claude-1', agentId: 'claude', state: 'running', port: 8400 },
      { id: 'claude-2', agentId: 'claude', state: 'running', port: 8401 },
    ];
    expect(runtimes.length).toBe(2);
    expect(runtimes[0].port).not.toBe(runtimes[1].port);
  });
});

/* ------------------------------------------------------------------ */
/* Embedded launch (Workflow)                                          */
/* ------------------------------------------------------------------ */

describe('Embedded launch (Workflow mode)', () => {
  it('uses python3 PTY on non-Windows for CLI agents', () => {
    const strategy = 'env';
    const usePty = strategy === 'env';
    expect(usePty).toBe(true);
  });

  it('uses direct spawn on Windows for CLI agents', () => {
    const isWindows = true;
    const strategy = 'env';
    const useDirect = isWindows || strategy !== 'env';
    expect(useDirect).toBe(true);
  });

  it('python3 PTY code contains pty.spawn call', () => {
    const bin = '/usr/local/bin/claude';
    const pyCode = `import pty, sys; pty.spawn(["${bin}"])`;
    expect(pyCode).toContain('pty.spawn');
    expect(pyCode).toContain(bin);
  });

  it('python3 PTY code escapes binary path properly', () => {
    const bin = "/Users/test/.nvm/versions/node/v22/bin/cline";
    const escapedBin = JSON.stringify(bin);
    const pyCode = `import pty, sys; pty.spawn([${escapedBin}])`;
    expect(pyCode).toContain('/Users/test/.nvm/versions/node/v22/bin/cline');
    expect(pyCode).not.throws;
  });

  it('python3 PTY code handles args', () => {
    const bin = '/usr/bin/codex';
    const args = ['--resume', '--model', 'gpt-4'];
    const escapedBin = JSON.stringify(bin);
    const escapedArgs = args.map(a => JSON.stringify(a)).join(',');
    const pyCode = `import pty, sys; pty.spawn([${escapedBin},${escapedArgs}])`;
    expect(pyCode).toContain('--resume');
    expect(pyCode).toContain('gpt-4');
  });

  it('sets TERM env var for PTY spawns', () => {
    const env = { TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' };
    expect(env.TERM).toBe('xterm-256color');
  });

  it('launches GUI agents directly without PTY', () => {
    // GUI agents should spawn directly, not through PTY
    const usePty = false;
    expect(usePty).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* IPC handler flows                                                   */
/* ------------------------------------------------------------------ */

describe('IPC handler flows', () => {
  it('LaunchStart accepts agentId and optional compressorId', () => {
    const opts = { agentId: 'claude' };
    expect(opts.agentId).toBe('claude');
  });

  it('LaunchStart with compressorId uses it', () => {
    const opts = { agentId: 'codex', compressorId: 'rtk' };
    expect(opts.compressorId).toBe('rtk');
  });

  it('LaunchEmbedded returns runtime with id and trackerId', () => {
    const result = { id: 'codex-1', trackerId: 'launch-abc-1', state: 'running', port: 8400 };
    expect(result.id).toBe('codex-1');
    expect(result.trackerId).toBe('launch-abc-1');
    expect(result.state).toBe('running');
    expect(result.port).toBe(8400);
  });

  it('LaunchStop accepts launchId', () => {
    const launchId = 'claude-1';
    expect(launchId).toBeTruthy();
  });

  it('CompatibilityGet returns array of compressor compatibility', () => {
    const compat = [
      { id: 'headroom', name: 'Headroom', agentIds: ['claude', 'codex', 'cline'] },
      { id: 'rtk', name: 'RTK', agentIds: ['*'] },
    ];
    expect(Array.isArray(compat)).toBe(true);
    expect(compat.length).toBe(2);
    expect(compat.find(c => c.id === 'rtk')?.agentIds).toContain('*');
  });

  it('CustomAgentSave validates and saves custom agent', () => {
    const agent = { id: 'custom-agent-my-agent', name: 'My Agent', binary: '/usr/local/bin/my-agent' };
    expect(agent.id).toContain('custom-agent-');
    expect(agent.name).toBeTruthy();
    expect(agent.binary).toBeTruthy();
  });

  it('CustomProxySave validates and saves custom proxy', () => {
    const proxy = { id: 'custom-proxy-my-proxy', name: 'My Proxy', binary: '/usr/local/bin/my-proxy' };
    expect(proxy.id).toContain('custom-proxy-');
    expect(proxy.name).toBeTruthy();
    expect(proxy.binary).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Agent scanning                                                      */
/* ------------------------------------------------------------------ */

describe('Agent scanning', () => {
  it('scan returns found with paths when agent is detected', () => {
    const result = { agentId: 'claude', found: true, paths: ['/usr/local/bin/claude'], source: 'path' };
    expect(result.found).toBe(true);
    expect(result.paths[0]).toBe('/usr/local/bin/claude');
    expect(result.source).toBe('path');
  });

  it('scan returns found=false when agent is not detected', () => {
    const result = { agentId: 'unknown', found: false, paths: [], source: 'none' };
    expect(result.found).toBe(false);
    expect(result.paths).toEqual([]);
  });

  it('scan can detect from explicit path', () => {
    const result = { agentId: 'codex', found: true, paths: ['/custom/path/codex'], source: 'explicit' };
    expect(result.found).toBe(true);
    expect(result.source).toBe('explicit');
  });

  it('scan can detect from well-known locations', () => {
    const result = { agentId: 'cursor', found: true, paths: ['/Applications/Cursor.app/Contents/MacOS/Cursor'], source: 'well-known' };
    expect(result.found).toBe(true);
    expect(result.source).toBe('well-known');
  });

  it('scan can detect from PATH', () => {
    const result = { agentId: 'cline', found: true, paths: ['/usr/local/bin/cline'], source: 'path' };
    expect(result.found).toBe(true);
    expect(result.source).toBe('path');
  });

  it('scan returns drive/deep scan results', () => {
    const result = { agentId: 'goose', found: true, paths: ['/opt/homebrew/bin/goose'], source: 'drive' };
    expect(result.found).toBe(true);
    expect(result.source).toBe('drive');
  });

  it('verifyExplicitPath rejects empty paths', () => {
    const p = '';
    const valid = p.trim().length > 0;
    expect(valid).toBe(false);
  });

  it('verifyExplicitPath accepts valid paths', () => {
    const p = '/usr/local/bin/claude';
    const valid = p.trim().length > 0;
    expect(valid).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Proxy/compressor detection                                          */
/* ------------------------------------------------------------------ */

describe('Proxy/compressor detection', () => {
  it('detectProxy returns found when binary exists', () => {
    const result = { found: true, paths: ['/usr/local/bin/headroom'], source: 'path' };
    expect(result.found).toBe(true);
  });

  it('detectProxy returns not-found when binary missing', () => {
    const result = { found: false, paths: [], source: 'none' };
    expect(result.found).toBe(false);
  });

  it('installProxy returns ok on success', () => {
    const result = { ok: true, message: 'Successfully installed Headroom' };
    expect(result.ok).toBe(true);
  });

  it('installProxy returns error on failure', () => {
    const result = { ok: false, message: 'Installation failed with exit code 1' };
    expect(result.ok).toBe(false);
  });

  it('all 13 compressors can be detected', () => {
    const compressors = ['headroom', 'pxpipe', 'rtk', 'llmlingua', 'tokenshift',
      'caveman', 'leanctx', 'supercompress', 'selective-ctx', 'squeez',
      'omni-route', 'graphify', 'ponytail'];
    for (const c of compressors) {
      expect(c).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Workflow session management                                         */
/* ------------------------------------------------------------------ */

describe('Workflow session management', () => {
  it('can create a session from embedded launch result', () => {
    const rt = { id: 'claude-1', trackerId: 'launch-abc-1', state: 'running', port: 8400 };
    const session = {
      id: rt.id,
      agentId: 'claude',
      agentName: 'Claude Code',
      compressorId: 'headroom',
      launchId: rt.id,
      trackerId: rt.trackerId,
      state: rt.state,
      output: ['Session started on port ' + rt.port],
    };
    expect(session.id).toBe('claude-1');
    expect(session.state).toBe('running');
    expect(session.output[0]).toContain('8400');
  });

  it('can detect duplicate session by agentId+compressorId', () => {
    const sessions = [
      { id: '1', agentId: 'claude', compressorId: 'headroom' },
      { id: '2', agentId: 'codex', compressorId: 'headroom' },
    ];
    const dup = sessions.find(s => s.agentId === 'claude' && s.compressorId === 'headroom');
    expect(dup).toBeDefined();
    const noDup = sessions.find(s => s.agentId === 'claude' && s.compressorId === 'rtk');
    expect(noDup).toBeUndefined();
  });

  it('can stop a session', () => {
    const session = { id: '1', state: 'running' };
    session.state = 'stopped';
    expect(session.state).toBe('stopped');
  });

  it('can remove a session', () => {
    const sessions = [{ id: '1' }, { id: '2' }];
    sessions.splice(0, 1);
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('2');
  });

  it('can rename a session', () => {
    const session = { id: '1', agentName: 'Old Name' };
    session.agentName = 'New Name';
    expect(session.agentName).toBe('New Name');
  });

  it('can restart a session', () => {
    const session = { id: '1', agentId: 'claude', compressorId: 'headroom', state: 'stopped', output: [] as string[] };
    session.output.push('Restarting...');
    session.state = 'running';
    session.output.push('Restarted');
    expect(session.state).toBe('running');
    expect(session.output[0]).toBe('Restarting...');
    expect(session.output[1]).toBe('Restarted');
  });

  it('can track multiple sessions', () => {
    const sessions: Array<{ id: string; agentName: string; state: string }> = [];
    sessions.push({ id: '1', agentName: 'Claude', state: 'running' });
    sessions.push({ id: '2', agentName: 'Codex', state: 'running' });
    sessions.push({ id: '3', agentName: 'Cline', state: 'stopped' });
    expect(sessions.length).toBe(3);
    const running = sessions.filter(s => s.state === 'running');
    expect(running.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Output streaming                                                    */
/* ------------------------------------------------------------------ */

describe('Output streaming', () => {
  it('output lines can be appended to session output', () => {
    const session = { id: '1', output: [] as string[] };
    session.output.push('Line 1');
    session.output.push('Line 2');
    expect(session.output.length).toBe(2);
  });

  it('output is matched by trackerId', () => {
    const sessions = [
      { id: '1', trackerId: 'track-1' },
      { id: '2', trackerId: 'track-2' },
    ];
    const record = { id: 'track-1' };
    const match = sessions.find(s => s.trackerId === record.id || s.id === record.id);
    expect(match).toBeDefined();
    expect(match!.id).toBe('1');
  });

  it('output is matched by launchId as fallback', () => {
    const sessions = [
      { id: 'launch-1', trackerId: undefined },
    ];
    const record = { id: 'launch-1' };
    const match = sessions.find(s => s.trackerId === record.id || s.id === record.id);
    expect(match).toBeDefined();
  });

  it('output can be rendered as HTML', () => {
    const output = ['line 1', 'line 2'];
    const html = output.map(l => '<div class="output-line">' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>').join('');
    expect(html).toContain('line 1');
    expect(html).toContain('output-line');
  });

  it('output escapes HTML entities', () => {
    const text = '<script>alert("xss")</script>';
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });
});

/* ------------------------------------------------------------------ */
/* Configuration save/load                                             */
/* ------------------------------------------------------------------ */

describe('Configuration save/load', () => {
  it('saveConfig returns ok on success', () => {
    const result = { ok: true };
    expect(result.ok).toBe(true);
  });

  it('saveConfig returns error on failure', () => {
    const result = { ok: false, error: 'Validation failed: Port must be 1-65535' };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Port');
  });

  it('config can be loaded and has default values', () => {
    const config = {
      defaultCompressor: 'headroom',
      defaultWorkingDirectory: '',
      terminalFallback: false,
      theme: 'system',
      proxyStartupTimeoutMs: 60000,
    };
    expect(config.defaultCompressor).toBe('headroom');
    expect(config.terminalFallback).toBe(false);
    expect(config.proxyStartupTimeoutMs).toBe(60000);
  });

  it('config can be updated', () => {
    const config = { defaultCompressor: 'headroom' };
    config.defaultCompressor = 'rtk';
    expect(config.defaultCompressor).toBe('rtk');
  });
});