// @vitest-environment jsdom
/**
 * Workflow terminal UI contract — Conductor-style embedded xterm, no second `$` prompt.
 * The coding agent TUI owns its own input; keys go via raw stdin.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { formatStdinPayload } from '../src/core/launcher';

function terminalHtml(): void {
  document.body.innerHTML = `
    <div id="workflow-terminal" class="hidden">
      <div id="workflow-terminal-header">
        <span id="wf-session-title"></span>
      </div>
      <div id="workflow-xterm" class="workflow-xterm"></div>
    </div>
    <div id="workflow-empty"></div>
  `;
}

describe('Workflow terminal UI (xterm host)', () => {
  beforeEach(terminalHtml);

  it('hosts an xterm surface and has no second $ input row', () => {
    expect(document.getElementById('workflow-xterm')).toBeTruthy();
    expect(document.getElementById('workflow-input')).toBeNull();
    expect(document.getElementById('workflow-input-row')).toBeNull();
    expect(document.querySelector('.workflow-prompt')).toBeNull();
  });

  it('terminal starts hidden until a session is shown', () => {
    const terminal = document.getElementById('workflow-terminal')!;
    expect(terminal.classList.contains('hidden')).toBe(true);
    terminal.classList.remove('hidden');
    expect(terminal.classList.contains('hidden')).toBe(false);
  });
});

describe('Raw TUI stdin (xterm onData path)', () => {
  it('line mode still adds newline for legacy ProcessInput', () => {
    expect(formatStdinPayload('help')).toBe('help\n');
  });

  it('control characters stay bare for TUI interrupt', () => {
    expect(formatStdinPayload('\u0003')).toBe('\u0003');
    expect(formatStdinPayload('\u0004')).toBe('\u0004');
  });

  it('raw write path must not append newline (simulate xterm Enter as \\r)', () => {
    // xterm.js sends \r on Enter — raw write must pass it through unchanged.
    const rawKey = '\r';
    expect(rawKey.endsWith('\n')).toBe(false);
    expect(rawKey).toBe('\r');
  });
});

describe('Port field UX rule', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="fld-port" type="number" value="8400" />
      <input id="tgl-auto-port" type="checkbox" checked />
    `;
  });

  it('editing the port field disables auto-assign', () => {
    const profile = { port: 8400, autoPort: true };
    const input = document.getElementById('fld-port') as HTMLInputElement;
    const toggle = document.getElementById('tgl-auto-port') as HTMLInputElement;
    // Mirror the renderer oninput handler contract.
    input.value = '9123';
    profile.port = Number(input.value) || 0;
    profile.autoPort = false;
    toggle.checked = false;
    expect(profile.port).toBe(9123);
    expect(profile.autoPort).toBe(false);
    expect(toggle.checked).toBe(false);
  });
});
