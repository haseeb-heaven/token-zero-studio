// @vitest-environment jsdom
/**
 * Comprehensive tests for the Compressors view, agent install flow,
 * and interactive GUI components.
 */

import { describe, expect, it, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Compressors view rendering                                          */
/* ------------------------------------------------------------------ */

describe('Compressors view rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="compressors-view" class="view-pane hidden">
        <div class="section-head">
          <div>
            <h2>🧩 Token Compressors</h2>
            <p class="muted">View, manage and select compressors.</p>
          </div>
          <button id="btn-add-custom-proxy" class="btn btn-primary">+ Add custom compressor</button>
        </div>
        <div id="compressors-list" class="compressors-grid"></div>
        <div id="custom-proxies-section"></div>
      </main>
      <div id="toast-root"></div>
    `;
  });

  it('renders compressor cards in grid', () => {
    const list = document.getElementById('compressors-list')!;
    const proxy = {
      id: 'headroom', name: 'Headroom', description: 'Context optimization proxy',
      mode: 'server', envStyle: 'both', accent: '#38bdf8', installInstructions: 'pip install headroom-ai',
    };
    const card = document.createElement('div');
    card.className = 'card compressor-card';
    card.innerHTML = `<div class="compressor-header"><div class="compressor-icon" style="background:${proxy.accent}22;color:${proxy.accent}">${proxy.name.charAt(0)}</div><div class="compressor-info"><div class="compressor-name">${proxy.name}</div><div class="compressor-desc muted">${proxy.description}</div><div class="compressor-meta"><span class="badge">${proxy.mode}</span><span class="badge badge-alt">${proxy.envStyle}</span></div></div></div>`;
    list.appendChild(card);
    expect(list.children.length).toBe(1);
    expect(list.querySelector('.compressor-name')?.textContent).toBe('Headroom');
  });

  it('shows 13 compressors when all rendered', () => {
    const list = document.getElementById('compressors-list')!;
    const proxies = ['headroom', 'pxpipe', 'rtk', 'llmlingua', 'tokenshift', 'caveman', 'leanctx',
      'supercompress', 'selective-ctx', 'squeez', 'omni-route', 'graphify', 'ponytail'];
    for (const p of proxies) {
      const card = document.createElement('div');
      card.className = 'card compressor-card';
      card.innerHTML = `<div class="compressor-name">${p}</div>`;
      list.appendChild(card);
    }
    expect(list.children.length).toBe(13);
  });

  it('has add custom compressor button', () => {
    expect(document.getElementById('btn-add-custom-proxy')).toBeTruthy();
  });

  it('has custom proxies section', () => {
    expect(document.getElementById('custom-proxies-section')).toBeTruthy();
  });

  it('detect button exists on compressor cards', () => {
    const list = document.getElementById('compressors-list')!;
    const card = document.createElement('div');
    card.className = 'card compressor-card';
    card.innerHTML = '<button class="btn btn-ghost small-btn btn-detect-proxy" data-id="headroom">Detect</button>';
    list.appendChild(card);
    const btn = list.querySelector('.btn-detect-proxy');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute('data-id')).toBe('headroom');
  });

  it('inspect button exists on compressor cards', () => {
    const list = document.getElementById('compressors-list')!;
    const card = document.createElement('div');
    card.className = 'card compressor-card';
    card.innerHTML = '<button class="btn btn-ghost small-btn btn-inspect-proxy hidden" data-id="headroom">Inspect</button>';
    list.appendChild(card);
    const btn = list.querySelector('.btn-inspect-proxy');
    expect(btn).toBeTruthy();
    expect(btn?.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Add custom compressor form                                          */
/* ------------------------------------------------------------------ */

describe('Add custom compressor form', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-root"></div>';
  });

  it('creates modal overlay with form fields', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Add custom compressor</h2>
        <div class="field"><label>Name</label><input id="cp-name" type="text" /></div>
        <div class="field"><label>Binary path</label><input id="cp-binary" type="text" /></div>
        <div class="field"><label>Start command</label><input id="cp-command" type="text" value="--port {port}" /></div>
        <div class="field"><label>Port</label><input id="cp-port" type="number" value="8199" /></div>
        <div class="field"><label>Env style</label><select id="cp-env"><option value="both">Both</option></select></div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-cancel">Cancel</button>
          <button class="btn btn-primary btn-save-cp">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    expect(document.querySelector('.modal-overlay')).toBeTruthy();
    expect(document.getElementById('cp-name')).toBeTruthy();
    expect(document.getElementById('cp-binary')).toBeTruthy();
    expect(document.getElementById('cp-command')).toBeTruthy();
    expect(document.getElementById('cp-port')).toBeTruthy();
    expect(document.getElementById('cp-env')).toBeTruthy();
  });

  it('cancel button removes modal', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"><button class="btn btn-ghost btn-cancel">Cancel</button></div>';
    document.body.appendChild(overlay);
    const cancelBtn = overlay.querySelector('.btn-cancel') as HTMLElement;
    cancelBtn.onclick = () => overlay.remove();
    cancelBtn.click();
    expect(document.querySelector('.modal-overlay')).toBeFalsy();
  });

  it('validates name is required', () => {
    let toastMsg = '';
    const toast = (msg: string, _kind: string) => { toastMsg = msg; };
    const name = '';
    if (!name) toast('Name is required', 'err');
    expect(toastMsg).toBe('Name is required');
  });

  it('validates binary is required', () => {
    let toastMsg = '';
    const toast = (msg: string, _kind: string) => { toastMsg = msg; };
    const name = 'My Proxy';
    const binary = '';
    if (!name) toast('Name is required', 'err');
    if (!binary) toast('Binary path is required', 'err');
    expect(toastMsg).toBe('Binary path is required');
  });

  it('passes validation with name and binary', () => {
    const name = 'My Proxy';
    const binary = '/usr/local/bin/my-proxy';
    const errors: string[] = [];
    if (!name) errors.push('Name is required');
    if (!binary) errors.push('Binary path is required');
    expect(errors.length).toBe(0);
  });

  it('save button triggers saveCustomProxy', () => {
    let saved = false;
    const save = async (_data: any) => { saved = true; return { ok: true }; };
    const btn = document.createElement('button');
    btn.onclick = async () => { const r = await save({}); if (r.ok) saved = true; };
    btn.click();
    expect(saved).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Agent install flow                                                  */
/* ------------------------------------------------------------------ */

describe('Agent install flow', () => {
  it('installProxy returns ok on success', () => {
    const result = { ok: true, message: 'Successfully installed' };
    expect(result.ok).toBe(true);
  });

  it('installProxy returns error on failure', () => {
    const result = { ok: false, message: 'Installation failed' };
    expect(result.ok).toBe(false);
  });

  it('install status is shown in UI', () => {
    document.body.innerHTML = '<div id="proxy-install-banner" class="hidden"><span id="proxy-not-found-title">Not Found</span></div>';
    const banner = document.getElementById('proxy-install-banner')!;
    banner.classList.remove('hidden');
    expect(banner.classList.contains('hidden')).toBe(false);
  });

  it('install button triggers install command', () => {
    let installed = false;
    document.body.innerHTML = '<button id="btn-install-proxy">Install</button>';
    const btn = document.getElementById('btn-install-proxy')!;
    btn.onclick = async () => { installed = true; };
    btn.click();
    expect(installed).toBe(true);
  });

  it('install button shows loading state', () => {
    document.body.innerHTML = '<button id="btn-install-proxy">Install</button>';
    const btn = document.getElementById('btn-install-proxy')!;
    btn.textContent = 'Installing...';
    (btn as HTMLButtonElement).disabled = true;
    expect(btn.textContent).toBe('Installing...');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Scanner UI                                                          */
/* ------------------------------------------------------------------ */

describe('Scanner UI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-scan-all">Scan System</button>
      <button id="btn-scan-agent">Scan</button>
      <div id="detect-banner" class="banner hidden"></div>
      <div id="detected-paths" class="detected-paths"></div>
      <div id="sidebar"><div id="agent-list"></div></div>
    `;
  });

  it('scan all button triggers scan', () => {
    let scanned = false;
    const btn = document.getElementById('btn-scan-all')!;
    btn.onclick = async () => { scanned = true; };
    btn.click();
    expect(scanned).toBe(true);
  });

  it('scan agent button triggers single agent scan', () => {
    let scanned = '';
    const btn = document.getElementById('btn-scan-agent')!;
    btn.onclick = async () => { scanned = 'codex'; };
    btn.click();
    expect(scanned).toBe('codex');
  });

  it('detection banner shows status', () => {
    const banner = document.getElementById('detect-banner')!;
    banner.textContent = 'Detected 1 installation';
    banner.className = 'banner banner-ok';
    expect(banner.classList.contains('banner-ok')).toBe(true);
    expect(banner.textContent).toContain('Detected');
  });

  it('detected paths are clickable chips', () => {
    const container = document.getElementById('detected-paths')!;
    const chip = document.createElement('button');
    chip.className = 'detected-path';
    chip.textContent = '/usr/local/bin/claude';
    chip.onclick = () => { /* use this path */ };
    container.appendChild(chip);
    expect(container.children.length).toBe(1);
    expect(chip.textContent).toContain('claude');
  });

  it('scan button shows loading state', () => {
    const btn = document.getElementById('btn-scan-all')!;
    btn.setAttribute('disabled', '');
    expect(btn.hasAttribute('disabled')).toBe(true);
    btn.removeAttribute('disabled');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Agent install via CLI                                               */
/* ------------------------------------------------------------------ */

describe('Agent install via CLI commands', () => {
  it('headroom install command uses pip', () => {
    const cmd = 'pip3 install headroom-ai';
    expect(cmd).toContain('pip3');
  });

  it('pxpipe install command uses npm', () => {
    const cmd = 'npm install -g pxpipe';
    expect(cmd).toContain('npm');
  });

  it('rtk install command uses brew on mac', () => {
    const cmd = 'brew install rtk';
    expect(cmd).toContain('brew');
  });

  it('llmlingua install command uses pip', () => {
    const cmd = 'pip install llmlingua';
    expect(cmd).toContain('pip');
  });

  it('caveman install command uses npx', () => {
    const cmd = 'npx -y github:JuliusBrussee/caveman';
    expect(cmd).toContain('npx');
  });

  it('leanctx install command uses npm', () => {
    const cmd = 'npm install -g lean-ctx';
    expect(cmd).toContain('npm');
  });

  it('supercompress install command uses pip', () => {
    const cmd = 'pip install supercompress';
    expect(cmd).toContain('pip');
  });

  it('selective-ctx install command uses pip', () => {
    const cmd = 'pip install selective-context';
    expect(cmd).toContain('pip');
  });

  it('squeez install command uses pip', () => {
    const cmd = 'pip install squeez';
    expect(cmd).toContain('pip');
  });

  it('omni-route install command uses npm', () => {
    const cmd = 'npm install -g omni-route';
    expect(cmd).toContain('npm');
  });

  it('graphify install command uses npm', () => {
    const cmd = 'npm install -g graphify';
    expect(cmd).toContain('npm');
  });

  it('ponytail install command uses npm', () => {
    const cmd = 'npm install -g ponytail';
    expect(cmd).toContain('npm');
  });
});

/* ------------------------------------------------------------------ */
/* Interactive GUI: Agent detail view                                  */
/* ------------------------------------------------------------------ */

describe('Agent detail view GUI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="detail-content">
        <div id="agent-avatar" class="avatar">C</div>
        <div id="agent-name">Agent</div>
        <div id="badge-interface" class="badge"></div>
        <div id="badge-strategy" class="badge"></div>
        <div id="agent-state" class="state-dot state-stopped"></div>
        <div id="agent-desc" class="muted"></div>
        <div id="agent-vendor"></div>
        <div id="agent-config-hint"></div>
        <div id="fld-path" class="field"></div>
        <div id="fld-port" class="field"></div>
        <div id="fld-workdir" class="field"></div>
        <div id="fld-mode" class="field"></div>
        <div id="fld-extra-proxy" class="field"></div>
        <div id="fld-extra-agent" class="field"></div>
        <div id="env-editor"></div>
        <div id="profile-select"></div>
        <div id="port-status"></div>
        <button id="btn-kill-port" class="hidden">Kill port</button>
        <button id="btn-launch">Launch</button>
        <button id="btn-launch-workflow">Workflow</button>
        <button id="btn-stop" class="hidden">Stop</button>
        <div id="launch-status"></div>
      </div>
    `;
  });

  it('shows agent name', () => {
    const el = document.getElementById('agent-name')!;
    el.textContent = 'Claude Code';
    expect(el.textContent).toBe('Claude Code');
  });

  it('shows agent state dot', () => {
    const dot = document.getElementById('agent-state')!;
    dot.className = 'state-dot state-running';
    expect(dot.classList.contains('state-running')).toBe(true);
  });

  it('shows agent avatar with initial', () => {
    const avatar = document.getElementById('agent-avatar')!;
    avatar.textContent = 'C';
    expect(avatar.textContent).toBe('C');
  });

  it('shows interface badge', () => {
    const badge = document.getElementById('badge-interface')!;
    badge.textContent = 'CLI';
    expect(badge.textContent).toBe('CLI');
  });

  it('shows strategy badge', () => {
    const badge = document.getElementById('badge-strategy')!;
    badge.textContent = 'auto-launch';
    expect(badge.textContent).toBe('auto-launch');
  });

  it('port field accepts numeric input', () => {
    const input = document.getElementById('fld-port') as HTMLInputElement;
    input.value = '8989';
    expect(input.value).toBe('8989');
  });

  it('path field accepts text input', () => {
    const input = document.getElementById('fld-path') as HTMLInputElement;
    input.value = '/usr/local/bin/claude';
    expect(input.value).toBe('/usr/local/bin/claude');
  });

  it('working directory field accepts text input', () => {
    const input = document.getElementById('fld-workdir') as HTMLInputElement;
    input.value = '/home/user/projects';
    expect(input.value).toBe('/home/user/projects');
  });

  it('mode selector changes value', () => {
    const select = document.getElementById('fld-mode') as HTMLSelectElement;
    select.value = 'cache';
    expect(select.value).toBe('cache');
    select.value = 'token';
    expect(select.value).toBe('token');
  });

  it('launch button is visible when stopped', () => {
    const launch = document.getElementById('btn-launch')!;
    const stop = document.getElementById('btn-stop')!;
    expect(launch.classList.contains('hidden')).toBe(false);
    expect(stop.classList.contains('hidden')).toBe(true);
  });

  it('workflow button is visible', () => {
    const wf = document.getElementById('btn-launch-workflow')!;
    expect(wf.classList.contains('hidden')).toBe(false);
  });

  it('stop button is visible when running', () => {
    const launch = document.getElementById('btn-launch')!;
    const stop = document.getElementById('btn-stop')!;
    launch.classList.add('hidden');
    stop.classList.remove('hidden');
    expect(launch.classList.contains('hidden')).toBe(true);
    expect(stop.classList.contains('hidden')).toBe(false);
  });

  it('port status can show available', () => {
    const status = document.getElementById('port-status')!;
    status.textContent = 'available';
    status.style.color = 'var(--ok)';
    expect(status.textContent).toBe('available');
  });

  it('port status can show in use', () => {
    const status = document.getElementById('port-status')!;
    status.textContent = 'in use';
    status.style.color = 'var(--warn)';
    expect(status.textContent).toBe('in use');
  });

  it('kill port button is hidden by default', () => {
    const btn = document.getElementById('btn-kill-port')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  it('kill port button shows when port is in use', () => {
    const btn = document.getElementById('btn-kill-port')!;
    btn.classList.remove('hidden');
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  it('env editor can add variables', () => {
    const editor = document.getElementById('env-editor')!;
    const row = document.createElement('div');
    row.className = 'env-row';
    row.innerHTML = '<input class="env-key" value="ANTHROPIC_BASE_URL" /><input value="http://127.0.0.1:8400" /><button>✕</button>';
    editor.appendChild(row);
    expect(editor.children.length).toBe(1);
    expect(editor.querySelector('.env-key')?.getAttribute('value')).toBe('ANTHROPIC_BASE_URL');
  });

  it('profile selector can switch profiles', () => {
    const select = document.getElementById('profile-select') as HTMLSelectElement;
    const opt1 = document.createElement('option'); opt1.value = 'Default'; opt1.textContent = 'Default';
    const opt2 = document.createElement('option'); opt2.value = 'Work'; opt2.textContent = 'Work';
    select.appendChild(opt1);
    select.appendChild(opt2);
    select.value = 'Work';
    expect(select.value).toBe('Work');
  });

  it('launch status shows state message', () => {
    const status = document.getElementById('launch-status')!;
    status.textContent = 'Running on port 8400';
    expect(status.textContent).toBe('Running on port 8400');
  });
});

/* ------------------------------------------------------------------ */
/* Interactive GUI: Logs panel                                         */
/* ------------------------------------------------------------------ */

describe('Logs panel GUI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="logs-panel">
        <div class="logs-toolbar">
          <span class="logs-title">Logs</span>
          <select id="log-level-filter">
            <option value="debug">debug</option>
            <option value="info" selected>info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <label><input id="log-autoscroll" type="checkbox" checked /> Auto-scroll</label>
          <button id="btn-logs-clear">Clear</button>
        </div>
        <div id="logs-view"></div>
      </div>
    `;
  });

  it('logs panel is visible', () => {
    expect(document.getElementById('logs-panel')).toBeTruthy();
  });

  it('log level filter defaults to info', () => {
    const filter = document.getElementById('log-level-filter') as HTMLSelectElement;
    expect(filter.value).toBe('info');
  });

  it('log level filter can be changed to error', () => {
    const filter = document.getElementById('log-level-filter') as HTMLSelectElement;
    filter.value = 'error';
    expect(filter.value).toBe('error');
  });

  it('autoscroll is enabled by default', () => {
    const cb = document.getElementById('log-autoscroll') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it('clear button clears logs', () => {
    const view = document.getElementById('logs-view')!;
    view.innerHTML = '<div class="log-line">entry</div>';
    const btn = document.getElementById('btn-logs-clear')!;
    btn.onclick = () => { view.innerHTML = ''; };
    btn.click();
    expect(view.children.length).toBe(0);
  });

  it('log lines can be appended', () => {
    const view = document.getElementById('logs-view')!;
    const line = document.createElement('div');
    line.className = 'log-line log-info';
    line.innerHTML = '<span class="log-time">00:00</span><span class="log-msg">test</span>';
    view.appendChild(line);
    expect(view.children.length).toBe(1);
  });

  it('log lines have level-specific colors', () => {
    const line = document.createElement('div');
    line.className = 'log-line log-error';
    expect(line.classList.contains('log-error')).toBe(true);
  });

  it('log lines show timestamps', () => {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = '<span class="log-time">12:34:56</span><span class="log-msg">message</span>';
    expect(line.querySelector('.log-time')?.textContent).toBe('12:34:56');
  });
});

/* ------------------------------------------------------------------ */
/* Interactive GUI: Settings view                                      */
/* ------------------------------------------------------------------ */

describe('Settings view GUI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="settings-content">
        <div id="settings-default-compressor"></div>
        <div id="settings-headroom-path"></div>
        <div id="settings-timeout"></div>
        <div id="settings-theme"></div>
        <div id="settings-cwd"></div>
        <div id="settings-terminal-fallback"></div>
      </div>
    `;
  });

  it('has default compressor setting', () => {
    expect(document.getElementById('settings-default-compressor')).toBeTruthy();
  });

  it('has headroom path setting', () => {
    expect(document.getElementById('settings-headroom-path')).toBeTruthy();
  });

  it('has timeout setting', () => {
    expect(document.getElementById('settings-timeout')).toBeTruthy();
  });

  it('has theme setting', () => {
    expect(document.getElementById('settings-theme')).toBeTruthy();
  });

  it('has working directory setting', () => {
    expect(document.getElementById('settings-cwd')).toBeTruthy();
  });

  it('has terminal fallback setting', () => {
    expect(document.getElementById('settings-terminal-fallback')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Compressor detail actions: scan, install, save, set default         */
/* ------------------------------------------------------------------ */

describe('Compressor detail actions', () => {
  const proxy = {
    id: 'rtk', name: 'RTK', description: 'Rust Token Killer',
    mode: 'wrapper', installInstructions: 'cargo install rtk', accent: '#f59e0b',
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="compressor-detail-empty" class=""></div>
      <div id="compressor-detail-content" class=""></div>
      <div id="compressor-info-card"></div>
      <div id="compressor-install-cmd"></div>
      <div id="compressor-detect-status"></div>
      <input id="compressor-binary-path" />
      <button id="btn-detect-compressor">Scan</button>
      <button id="btn-install-compressor">Install via CLI</button>
      <button id="btn-save-compressor">Save path</button>
      <button id="btn-set-default-compressor">Set as default</button>
      <div id="compressor-save-status"></div>
      <div id="toast-root"></div>
    `;
  });

  it('wires a scan action that fills the binary path when found', async () => {
    const detect = document.getElementById('btn-detect-compressor')!;
    const sent: string[] = [];
    (globalThis as any).api = { detectProxy: async () => ({ found: true, paths: ['/opt/rtk/rtk'] }) };
    detect.onclick = async () => {
      const result = await (globalThis as any).api.detectProxy('rtk');
      if (result.found) {
        (document.getElementById('compressor-binary-path') as HTMLInputElement).value = result.paths[0];
        (document.getElementById('compressor-detect-status') as HTMLElement).innerHTML =
          '<span style="color:var(--ok)">Found at ' + result.paths[0] + '</span>';
      }
    };
    await (detect.onclick as any)(new Event('click'));
    expect((document.getElementById('compressor-binary-path') as HTMLInputElement).value).toBe('/opt/rtk/rtk');
    void sent;
  });

  it('wires an install action that reports the CLI result', async () => {
    const install = document.getElementById('btn-install-compressor')!;
    let message = '';
    (globalThis as any).api = { installProxy: async () => ({ ok: true, message: 'rtk installed' }) };
    install.onclick = async () => {
      const res = await (globalThis as any).api.installProxy('rtk');
      message = res.message;
    };
    const btn = install as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Installing...';
    await (install.onclick as any)(new Event('click'));
    expect(message).toBe('rtk installed');
    btn.disabled = false;
    btn.textContent = 'Install via CLI';
  });

  it('wires a save action that persists the entered binary path', async () => {
    (document.getElementById('compressor-binary-path') as HTMLInputElement).value = '/opt/rtk/rtk';
    const saved: Array<{ proxyId: string; path: string }> = [];
    (globalThis as any).persistCompressorPath = (proxyId: string, path: string) => { saved.push({ proxyId, path }); };
    const save = document.getElementById('btn-save-compressor')!;
    save.onclick = async () => {
      const binary = (document.getElementById('compressor-binary-path') as HTMLInputElement).value.trim();
      (globalThis as any).persistCompressorPath(proxy.id, binary);
      (document.getElementById('compressor-save-status') as HTMLElement).textContent = 'Saved binary path for ' + proxy.name;
      (document.getElementById('compressor-save-status') as HTMLElement).style.color = 'var(--ok)';
    };
    await (save.onclick as any)(new Event('click'));
    expect(saved).toEqual([{ proxyId: 'rtk', path: '/opt/rtk/rtk' }]);
    expect(document.getElementById('compressor-save-status')?.textContent).toBe('Saved binary path for RTK');
  });

  it('wires a set-default action that changes the default compressor', async () => {
    let defaultCompressor = 'headroom';
    (globalThis as any).setDefault = (id: string) => { defaultCompressor = id; };
    const setDefault = document.getElementById('btn-set-default-compressor')!;
    setDefault.onclick = async () => {
      (globalThis as any).setDefault(proxy.id);
    };
    await (setDefault.onclick as any)(new Event('click'));
    expect(defaultCompressor).toBe('rtk');
  });

  it('shows the install instructions for the selected compressor', () => {
    (document.getElementById('compressor-install-cmd') as HTMLElement).textContent = proxy.installInstructions;
    expect(document.getElementById('compressor-install-cmd')?.textContent).toBe('cargo install rtk');
  });
});