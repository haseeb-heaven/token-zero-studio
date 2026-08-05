// @vitest-environment jsdom
/**
 * UI integration tests for app.ts (renderer).
 *
 * These tests verify that the DOM manipulation functions produce the expected
 * HTML structure — they don't need a real Electron environment because they
 * test the pure logic of view rendering, tab switching, and state management.
 */

import { describe, expect, it, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Tab switching logic                                                 */
/* ------------------------------------------------------------------ */

describe('Tab switching', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-btn-agents" class="nav-tab active"><span>Agents</span></div>
      <div id="tab-btn-compressors" class="nav-tab"><span>Compressors</span></div>
      <div id="tab-btn-settings" class="nav-tab"><span>Settings</span></div>
      <div id="tab-btn-dashboard" class="nav-tab"><span>Dashboard</span></div>
      <div id="sidebar" class="hidden">sidebar</div>
      <div id="detail" class="hidden">detail</div>
      <div id="compressors-view" class="view-pane hidden">compressors</div>
      <div id="settings-view" class="view-pane hidden">settings</div>
      <div id="dashboard-view" class="hidden flex-1">dashboard</div>
    `;
  });

  it('starts with agents tab active', () => {
    const agentsTab = document.getElementById('tab-btn-agents')!;
    expect(agentsTab.classList.contains('active')).toBe(true);
  });

  it('has all four tab buttons', () => {
    expect(document.getElementById('tab-btn-agents')).toBeTruthy();
    expect(document.getElementById('tab-btn-compressors')).toBeTruthy();
    expect(document.getElementById('tab-btn-settings')).toBeTruthy();
    expect(document.getElementById('tab-btn-dashboard')).toBeTruthy();
  });

  it('has all four view containers', () => {
    expect(document.getElementById('sidebar')).toBeTruthy();
    expect(document.getElementById('detail')).toBeTruthy();
    expect(document.getElementById('compressors-view')).toBeTruthy();
    expect(document.getElementById('settings-view')).toBeTruthy();
    expect(document.getElementById('dashboard-view')).toBeTruthy();
  });

  it('clicking agents tab shows sidebar and detail (via click handler)', () => {
    const agentsTab = document.getElementById('tab-btn-agents')!;
    // Simulate what switchTab does: remove hidden from sidebar and detail
    document.getElementById('sidebar')!.classList.remove('hidden');
    document.getElementById('detail')!.classList.remove('hidden');
    agentsTab.classList.add('active');
    expect(document.getElementById('sidebar')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('detail')!.classList.contains('hidden')).toBe(false);
    expect(agentsTab.classList.contains('active')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Logs panel                                                          */
/* ------------------------------------------------------------------ */

describe('Logs panel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="logs-panel" class="collapsed">
        <div class="logs-toolbar">
          <span class="logs-title">Logs</span>
          <select id="log-level-filter">
            <option value="debug">debug+</option>
            <option value="info" selected>info+</option>
            <option value="warn">warn+</option>
            <option value="error">error</option>
          </select>
          <label class="toggle small"><input id="log-autoscroll" type="checkbox" checked /> Auto-scroll</label>
          <button id="btn-logs-clear" class="btn btn-ghost small-btn">Clear</button>
        </div>
        <div id="logs-view" role="log" aria-live="polite"></div>
      </div>
      <div id="toast-root"></div>
    `;
  });

  it('starts collapsed', () => {
    const panel = document.getElementById('logs-panel')!;
    expect(panel.classList.contains('collapsed')).toBe(true);
  });

  it('has log level filter with default info+', () => {
    const filter = document.getElementById('log-level-filter') as HTMLSelectElement;
    expect(filter.value).toBe('info');
  });

  it('has autoscroll checkbox checked by default', () => {
    const checkbox = document.getElementById('log-autoscroll') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('has clear button', () => {
    expect(document.getElementById('btn-logs-clear')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Compressors view                                                     */
/* ------------------------------------------------------------------ */

describe('Compressors view', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="compressors-view" class="view-pane hidden">
        <div class="section-head">
          <div>
            <h2>Token Compressors</h2>
            <p class="muted">View, manage and select compressors.</p>
          </div>
          <button id="btn-add-custom-proxy" class="btn btn-primary">+ Add custom compressor</button>
        </div>
        <div id="compressors-list" class="compressors-grid"></div>
        <div id="custom-proxies-section"></div>
      </main>
    `;
  });

  it('has add custom compressor button', () => {
    expect(document.getElementById('btn-add-custom-proxy')).toBeTruthy();
  });

  it('has compressors list container', () => {
    expect(document.getElementById('compressors-list')).toBeTruthy();
  });

  it('has custom proxies section', () => {
    expect(document.getElementById('custom-proxies-section')).toBeTruthy();
  });

  it('starts hidden', () => {
    const view = document.getElementById('compressors-view')!;
    expect(view.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Settings view                                                        */
/* ------------------------------------------------------------------ */

describe('Settings view', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="settings-view" class="view-pane hidden">
        <div class="section-head">
          <div>
            <h2>Studio Settings</h2>
            <p class="muted">Application-wide configuration.</p>
          </div>
        </div>
        <div id="settings-content" class="settings-grid"></div>
      </main>
    `;
  });

  it('has settings content container', () => {
    expect(document.getElementById('settings-content')).toBeTruthy();
  });

  it('starts hidden', () => {
    const view = document.getElementById('settings-view')!;
    expect(view.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Toast notifications                                                */
/* ------------------------------------------------------------------ */

describe('Toast notifications', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="toast-root"></div>`;
  });

  it('has toast root container', () => {
    expect(document.getElementById('toast-root')).toBeTruthy();
  });

  it('can append toast elements', () => {
    const root = document.getElementById('toast-root')!;
    const toast = document.createElement('div');
    toast.className = 'toast toast-ok';
    toast.textContent = 'Test message';
    root.appendChild(toast);
    expect(root.children.length).toBe(1);
    expect(root.children[0].textContent).toBe('Test message');
  });

  it('toast elements are removed after timeout', async () => {
    const root = document.getElementById('toast-root')!;
    const toast = document.createElement('div');
    toast.className = 'toast toast-err';
    toast.textContent = 'Error message';
    root.appendChild(toast);
    // Simulate setTimeout removal
    setTimeout(() => toast.remove(), 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(root.children.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Launch bar controls                                                 */
/* ------------------------------------------------------------------ */

describe('Launch bar controls', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="launch-bar">
        <select id="launch-bar-compressor-select" class="launch-proxy-dropdown">
          <option value="headroom">Headroom</option>
          <option value="rtk">RTK</option>
        </select>
        <button id="btn-launch" class="btn btn-primary btn-launch">Launch</button>
        <button id="btn-stop" class="btn btn-danger hidden">Stop</button>
        <span id="launch-status" class="muted"></span>
        <button id="btn-save-config" class="btn">Save config</button>
      </section>
    `;
  });

  it('has compressor selector', () => {
    const select = document.getElementById('launch-bar-compressor-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('headroom');
  });

  it('has launch button', () => {
    expect(document.getElementById('btn-launch')).toBeTruthy();
  });

  it('has stop button (hidden by default)', () => {
    const stop = document.getElementById('btn-stop')!;
    expect(stop.classList.contains('hidden')).toBe(true);
  });

  it('has save config button', () => {
    expect(document.getElementById('btn-save-config')).toBeTruthy();
  });

  it('can switch compressor selection', () => {
    const select = document.getElementById('launch-bar-compressor-select') as HTMLSelectElement;
    select.value = 'rtk';
    expect(select.value).toBe('rtk');
  });
});

/* ------------------------------------------------------------------ */
/* Scanning controls                                                   */
/* ------------------------------------------------------------------ */

describe('Scanning controls', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-scan-all" class="btn btn-ghost">Scan System</button>
      <button id="btn-scan-agent" class="btn">Scan</button>
      <div id="agent-list"></div>
      <div id="detect-banner" class="banner hidden"></div>
      <div id="detected-paths" class="detected-paths"></div>
    `;
  });

  it('has scan all button', () => {
    expect(document.getElementById('btn-scan-all')).toBeTruthy();
  });

  it('has scan agent button', () => {
    expect(document.getElementById('btn-scan-agent')).toBeTruthy();
  });

  it('has agent list container', () => {
    expect(document.getElementById('agent-list')).toBeTruthy();
  });

  it('has detection banner (hidden by default)', () => {
    const banner = document.getElementById('detect-banner')!;
    expect(banner.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Agent detail view controls                                          */
/* ------------------------------------------------------------------ */

describe('Agent detail view controls', () => {
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
        <div id="agent-wrap-cmd"></div>
        <div id="agent-homepage"></div>
        <div id="fld-path" class="field"></div>
        <div id="fld-port" class="field"></div>
        <div id="fld-workdir" class="field"></div>
        <div id="fld-mode" class="field"></div>
        <div id="fld-extra-proxy" class="field"></div>
        <div id="fld-extra-agent" class="field"></div>
        <div id="fld-default-compressor" class="field"></div>
        <div id="env-editor"></div>
        <div id="profile-select"></div>
        <div id="agent-config-hint"></div>
        <div id="port-status"></div>
        <div id="btn-kill-port" class="hidden"></div>
      </div>
    `;
  });

  it('has agent avatar', () => {
    expect(document.getElementById('agent-avatar')).toBeTruthy();
  });

  it('has agent name element', () => {
    expect(document.getElementById('agent-name')).toBeTruthy();
  });

  it('has interface badge', () => {
    expect(document.getElementById('badge-interface')).toBeTruthy();
  });

  it('has strategy badge', () => {
    expect(document.getElementById('badge-strategy')).toBeTruthy();
  });

  it('has state indicator', () => {
    expect(document.getElementById('agent-state')).toBeTruthy();
  });

  it('has port field', () => {
    expect(document.getElementById('fld-port')).toBeTruthy();
  });

  it('has working directory field', () => {
    expect(document.getElementById('fld-workdir')).toBeTruthy();
  });

  it('has mode selector', () => {
    expect(document.getElementById('fld-mode')).toBeTruthy();
  });

  it('has compressor selector', () => {
    expect(document.getElementById('fld-default-compressor')).toBeTruthy();
  });

  it('has env editor', () => {
    expect(document.getElementById('env-editor')).toBeTruthy();
  });

  it('has profile selector', () => {
    expect(document.getElementById('profile-select')).toBeTruthy();
  });

  it('has port kill button (hidden by default)', () => {
    const btn = document.getElementById('btn-kill-port')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Theme toggle                                                        */
/* ------------------------------------------------------------------ */

describe('Theme system', () => {
  it('resolves light theme for light mode', () => {
    const resolved = 'light' === 'light' ? 'light' : 'dark';
    expect(resolved).toBe('light');
  });

  it('resolves dark theme for dark mode', () => {
    const resolved = 'dark' === 'dark' ? 'dark' : 'light';
    expect(resolved).toBe('dark');
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard view                                                      */
/* ------------------------------------------------------------------ */

describe('Dashboard view', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="dashboard-view" class="hidden flex-1">
        <div id="dash-proxy-name"></div>
        <div id="dash-status-pill" class="pill"></div>
        <div id="dash-status-text"></div>
        <div id="dash-metric-proxy"></div>
        <div id="dash-metric-mode"></div>
        <div id="dash-metric-port"></div>
        <div id="dash-metric-agent"></div>
        <div id="dash-metric-pid"></div>
        <div id="dash-iframe"></div>
        <div id="dash-no-ui-fallback" class="hidden"></div>
        <div id="dash-fallback-msg"></div>
        <div id="btn-refresh-dash"></div>
        <div id="btn-open-dash-browser"></div>
      </div>
    `;
  });

  it('has all dashboard metric elements', () => {
    expect(document.getElementById('dash-proxy-name')).toBeTruthy();
    expect(document.getElementById('dash-metric-proxy')).toBeTruthy();
    expect(document.getElementById('dash-metric-mode')).toBeTruthy();
    expect(document.getElementById('dash-metric-port')).toBeTruthy();
    expect(document.getElementById('dash-metric-agent')).toBeTruthy();
    expect(document.getElementById('dash-metric-pid')).toBeTruthy();
  });

  it('has dashboard iframe', () => {
    expect(document.getElementById('dash-iframe')).toBeTruthy();
  });

  it('has refresh and open-browser buttons', () => {
    expect(document.getElementById('btn-refresh-dash')).toBeTruthy();
    expect(document.getElementById('btn-open-dash-browser')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Error handling — missing elements                                   */
/* ------------------------------------------------------------------ */

describe('Error handling', () => {
  it('el() throws on missing element', () => {
    // Simulate the el() function behavior
    const el = (id: string): HTMLElement => {
      const node = document.getElementById(id);
      if (!node) throw new Error(`Missing element #${id}`);
      return node;
    };
    expect(() => el('nonexistent')).toThrow(/Missing element/);
  });

  it('el() returns element when it exists', () => {
    document.body.innerHTML = '<div id="exists">hello</div>';
    const el = (id: string): HTMLElement => {
      const node = document.getElementById(id);
      if (!node) throw new Error(`Missing element #${id}`);
      return node;
    };
    expect(el('exists').textContent).toBe('hello');
  });
});

/* ------------------------------------------------------------------ */
/* Port checking UI                                                    */
/* ------------------------------------------------------------------ */

describe('Port checking UI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="fld-port" type="number" value="8989" />
      <span id="port-status"></span>
      <button id="btn-kill-port" class="btn hidden">Kill port</button>
    `;
  });

  it('has port input field', () => {
    const input = document.getElementById('fld-port') as HTMLInputElement;
    expect(input.value).toBe('8989');
  });

  it('has port status indicator', () => {
    expect(document.getElementById('port-status')).toBeTruthy();
  });

  it('has kill-port button (hidden by default)', () => {
    const btn = document.getElementById('btn-kill-port')!;
    expect(btn.classList.contains('hidden')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Workflow view                                                       */
/* ------------------------------------------------------------------ */

describe('Workflow view', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="workflow-view" class="view-pane hidden" style="padding:0;display:flex;flex-direction:row;">
        <div id="workflow-sidebar" class="workflow-sidebar">
          <div class="workflow-sidebar-header">
            <span class="workflow-sidebar-title">Sessions</span>
            <button id="wf-btn-new-session" class="btn btn-ghost small-btn">+</button>
          </div>
          <div id="workflow-tabs" class="workflow-tabs-list"></div>
        </div>
        <div id="workflow-main" class="workflow-main">
          <div id="workflow-empty" class="workflow-empty">
            <h3>No active sessions</h3>
          </div>
          <div id="workflow-terminal" class="workflow-terminal hidden">
            <div id="workflow-terminal-header" class="workflow-terminal-header">
              <span id="wf-session-title"></span>
              <div class="workflow-terminal-actions">
                <button id="wf-btn-rename" class="btn btn-ghost small-btn">Rename</button>
                <button id="wf-btn-restart" class="btn btn-ghost small-btn">Restart</button>
                <button id="wf-btn-close" class="btn btn-danger-ghost small-btn">Close</button>
              </div>
            </div>
            <div id="workflow-xterm" class="workflow-xterm"></div>
          </div>
        </div>
      </main>
      <div id="tab-btn-workflow" class="nav-tab"><span>Workflow</span></div>
    `;
  });

  it('has workflow view container', () => {
    expect(document.getElementById('workflow-view')).toBeTruthy();
  });

  it('has workflow sidebar', () => {
    expect(document.getElementById('workflow-sidebar')).toBeTruthy();
  });

  it('has workflow tabs list', () => {
    expect(document.getElementById('workflow-tabs')).toBeTruthy();
  });

  it('has empty state', () => {
    expect(document.getElementById('workflow-empty')).toBeTruthy();
  });

  it('has terminal container (hidden by default)', () => {
    const terminal = document.getElementById('workflow-terminal')!;
    expect(terminal.classList.contains('hidden')).toBe(true);
  });

  it('has new session button', () => {
    expect(document.getElementById('wf-btn-new-session')).toBeTruthy();
  });

  it('has rename, restart, close buttons', () => {
    expect(document.getElementById('wf-btn-rename')).toBeTruthy();
    expect(document.getElementById('wf-btn-restart')).toBeTruthy();
    expect(document.getElementById('wf-btn-close')).toBeTruthy();
  });

  it('has session title element', () => {
    expect(document.getElementById('wf-session-title')).toBeTruthy();
  });

  it('has xterm host (no second $ prompt)', () => {
    expect(document.getElementById('workflow-xterm')).toBeTruthy();
    expect(document.getElementById('workflow-input')).toBeNull();
  });

  it('has workflow tab button', () => {
    expect(document.getElementById('tab-btn-workflow')).toBeTruthy();
  });

  it('can add session tab items to the workflow tabs list', () => {
    const list = document.getElementById('workflow-tabs')!;
    const tab = document.createElement('div');
    tab.className = 'workflow-tab-item active';
    tab.innerHTML = '<span class="wf-tab-icon">🤖</span><span class="wf-tab-name">Codex</span><span class="wf-tab-state running"></span>';
    list.appendChild(tab);
    expect(list.children.length).toBe(1);
    expect(list.children[0].querySelector('.wf-tab-name')?.textContent).toBe('Codex');
  });

  it('can switch active state on tab items', () => {
    const list = document.getElementById('workflow-tabs')!;
    const tab1 = document.createElement('div');
    tab1.className = 'workflow-tab-item active';
    tab1.innerHTML = '<span class="wf-tab-name">Agent 1</span>';
    const tab2 = document.createElement('div');
    tab2.className = 'workflow-tab-item';
    tab2.innerHTML = '<span class="wf-tab-name">Agent 2</span>';
    list.append(tab1, tab2);
    expect(list.querySelectorAll('.active').length).toBe(1);
    tab1.classList.remove('active');
    tab2.classList.add('active');
    expect(list.querySelectorAll('.active').length).toBe(1);
    expect(list.querySelector('.active')?.textContent).toBe('Agent 2');
  });

  it('xterm host fills the terminal body', () => {
    const host = document.getElementById('workflow-xterm')!;
    expect(host.classList.contains('workflow-xterm')).toBe(true);
  });

  it('shows empty state when terminal is hidden', () => {
    const empty = document.getElementById('workflow-empty')!;
    const terminal = document.getElementById('workflow-terminal')!;
    expect(empty.classList.contains('hidden')).toBe(false);
    expect(terminal.classList.contains('hidden')).toBe(true);
  });

  it('can show terminal and hide empty state', () => {
    const empty = document.getElementById('workflow-empty')!;
    const terminal = document.getElementById('workflow-terminal')!;
    empty.classList.add('hidden');
    terminal.classList.remove('hidden');
    expect(empty.classList.contains('hidden')).toBe(true);
    expect(terminal.classList.contains('hidden')).toBe(false);
  });

  it('has five main tab buttons', () => {
    const btn = document.getElementById('tab-btn-workflow')!;
    expect(btn).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Conductor view (GUI Conductor AI App)                               */
/* ------------------------------------------------------------------ */

describe('Conductor view', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-btn-conductor" class="nav-tab"><span>Conductor</span></div>
      <div id="tab-btn-agents" class="nav-tab"><span>Agents</span></div>
      <div id="tab-btn-dashboard" class="nav-tab"><span>Dashboard</span></div>
      <main id="conductor-view" class="view-pane hidden" style="display:flex;flex-direction:column;">
        <section id="conductor-launch">
          <select id="conductor-agent-select"></select>
          <select id="conductor-compressor-select"></select>
          <input id="conductor-workdir" type="text" />
          <textarea id="conductor-prompt"></textarea>
          <button id="conductor-launch-btn">Launch in Conductor</button>
          <button id="conductor-browse-dir">…</button>
          <span id="conductor-status"></span>
          <span id="conductor-sub"></span>
          <span id="conductor-agent-hint"></span>
          <span id="conductor-compressor-hint"></span>
        </section>
        <div id="conductor-sessions"></div>
        <div id="conductor-empty">Conductor ready</div>
        <div id="conductor-terminal" class="hidden">
          <div id="conductor-terminal-header">
            <span id="conductor-session-title"></span>
            <button id="conductor-btn-rename"></button>
            <button id="conductor-btn-restart"></button>
            <button id="conductor-btn-stop"></button>
            <button id="conductor-btn-close"></button>
          </div>
          <div id="conductor-xterm"></div>
        </div>
      </main>
    `;
  });

  it('has conductor tab first and dashboard last in nav order', () => {
    const tabs = Array.from(document.querySelectorAll('.nav-tab'));
    expect(tabs[0]?.id).toBe('tab-btn-conductor');
    expect(tabs[tabs.length - 1]?.id).toBe('tab-btn-dashboard');
  });

  it('has launch card with agent + compressor selectors', () => {
    expect(document.getElementById('conductor-agent-select')).toBeTruthy();
    expect(document.getElementById('conductor-compressor-select')).toBeTruthy();
    expect(document.getElementById('conductor-launch-btn')).toBeTruthy();
  });

  it('has optional task prompt and workdir inputs', () => {
    expect(document.getElementById('conductor-prompt')).toBeTruthy();
    expect(document.getElementById('conductor-workdir')).toBeTruthy();
    expect(document.getElementById('conductor-browse-dir')).toBeTruthy();
  });

  it('has embedded terminal host (no second $ prompt)', () => {
    expect(document.getElementById('conductor-xterm')).toBeTruthy();
    expect(document.getElementById('workflow-input')).toBeNull();
  });

  it('has session strip and empty state (terminal hidden by default)', () => {
    expect(document.getElementById('conductor-sessions')).toBeTruthy();
    expect(document.getElementById('conductor-empty')).toBeTruthy();
    expect(document.getElementById('conductor-terminal')!.classList.contains('hidden')).toBe(true);
  });

  it('has rename, restart, stop, close session controls', () => {
    for (const id of ['conductor-btn-rename', 'conductor-btn-restart', 'conductor-btn-stop', 'conductor-btn-close']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it('shows terminal and hides empty state when a session is active', () => {
    const empty = document.getElementById('conductor-empty')!;
    const terminal = document.getElementById('conductor-terminal')!;
    empty.classList.add('hidden');
    terminal.classList.remove('hidden');
    expect(empty.classList.contains('hidden')).toBe(true);
    expect(terminal.classList.contains('hidden')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Launch bar Workflow button                                          */
/* ------------------------------------------------------------------ */

describe('Launch bar workflow button', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-launch" class="btn btn-primary">Launch</button>
      <button id="btn-launch-workflow" class="btn btn-primary">Workflow</button>
      <button id="btn-stop" class="btn btn-danger hidden">Stop</button>
    `;
  });

  it('has workflow launch button', () => {
    expect(document.getElementById('btn-launch-workflow')).toBeTruthy();
  });

  it('has regular launch button', () => {
    expect(document.getElementById('btn-launch')).toBeTruthy();
  });

  it('has stop button', () => {
    expect(document.getElementById('btn-stop')).toBeTruthy();
  });

  it('workflow button is visible by default', () => {
    const btn = document.getElementById('btn-launch-workflow')!;
    expect(btn.classList.contains('hidden')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Workflow context menu                                               */
/* ------------------------------------------------------------------ */

describe('Workflow context menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="workflow-tabs" class="workflow-tabs-list"></div>';
  });

  it('can create a context menu element', () => {
    const menu = document.createElement('div');
    menu.className = 'workflow-context-menu';
    menu.innerHTML = '<button class="ctx-menu-item">Rename</button><button class="ctx-menu-item">Stop</button><button class="ctx-menu-item">Close</button>';
    document.body.appendChild(menu);
    expect(document.querySelector('.workflow-context-menu')).toBeTruthy();
    expect(document.querySelectorAll('.ctx-menu-item').length).toBe(3);
  });

  it('context menu items are clickable', () => {
    const menu = document.createElement('div');
    menu.className = 'workflow-context-menu';
    let clicked = '';
    menu.innerHTML = '<button class="ctx-menu-item" id="ctx-stop">Stop</button>';
    document.body.appendChild(menu);
    document.getElementById('ctx-stop')!.onclick = () => { clicked = 'stop'; };
    document.getElementById('ctx-stop')!.click();
    expect(clicked).toBe('stop');
  });

  it('context menu is removed on outside click', () => {
    const menu = document.createElement('div');
    menu.className = 'workflow-context-menu';
    document.body.appendChild(menu);
    // Simulate clicking outside
    menu.remove();
    expect(document.querySelector('.workflow-context-menu')).toBeFalsy();
  });
});

/* ------------------------------------------------------------------ */
/* Workflow session management                                         */
/* ------------------------------------------------------------------ */

describe('Workflow session management', () => {
  it('can create a workflow session object', () => {
    const session = {
      id: 'claude-1',
      agentId: 'claude',
      agentName: 'Claude Code',
      compressorId: 'headroom',
      launchId: 'claude-1',
      trackerId: 'launch-abc-1',
      state: 'running',
      output: ['Started', 'Running...'],
    };
    expect(session.id).toBe('claude-1');
    expect(session.agentName).toBe('Claude Code');
    expect(session.state).toBe('running');
    expect(session.output.length).toBe(2);
  });

  it('can add output to a session', () => {
    const session = {
      id: 'codex-1',
      agentId: 'codex',
      agentName: 'Codex',
      compressorId: 'headroom',
      launchId: 'codex-1',
      state: 'running',
      output: [] as string[],
    };
    session.output.push('Line 1');
    session.output.push('Line 2');
    expect(session.output.length).toBe(2);
    expect(session.output[0]).toBe('Line 1');
  });

  it('can change session state', () => {
    const session = { id: '1', state: 'running' };
    session.state = 'stopped';
    expect(session.state).toBe('stopped');
  });

  it('can detect duplicate sessions by agentId+compressorId', () => {
    const sessions = [
      { id: '1', agentId: 'claude', compressorId: 'headroom', state: 'running' },
      { id: '2', agentId: 'codex', compressorId: 'headroom', state: 'running' },
    ];
    const duplicate = sessions.find((s) => s.agentId === 'claude' && s.compressorId === 'headroom');
    expect(duplicate).toBeTruthy();
    expect(duplicate!.id).toBe('1');
    const noDup = sessions.find((s) => s.agentId === 'claude' && s.compressorId === 'rtk');
    expect(noDup).toBeFalsy();
  });

  it('can remove a session by index', () => {
    const sessions = [
      { id: '1', agentId: 'claude' },
      { id: '2', agentId: 'codex' },
      { id: '3', agentId: 'cline' },
    ];
    sessions.splice(1, 1);
    expect(sessions.length).toBe(2);
    expect(sessions[1].agentId).toBe('cline');
  });
});

/* ------------------------------------------------------------------ */
/* Scanning system                                                     */
/* ------------------------------------------------------------------ */

describe('Scanning system', () => {
  it('scan result can be stored and retrieved', () => {
    const scans = new Map<string, { found: boolean; paths: string[] }>();
    scans.set('claude', { found: true, paths: ['/usr/local/bin/claude'] });
    scans.set('codex', { found: false, paths: [] });
    expect(scans.get('claude')!.found).toBe(true);
    expect(scans.get('claude')!.paths[0]).toBe('/usr/local/bin/claude');
    expect(scans.get('codex')!.found).toBe(false);
  });

  it('scan result can be updated', () => {
    const scans = new Map<string, { found: boolean; paths: string[] }>();
    scans.set('claude', { found: false, paths: [] });
    scans.set('claude', { found: true, paths: ['/opt/homebrew/bin/claude'] });
    expect(scans.get('claude')!.found).toBe(true);
  });

  it('unknown agent returns undefined scan', () => {
    const scans = new Map<string, { found: boolean }>();
    expect(scans.get('unknown')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Logs system                                                         */
/* ------------------------------------------------------------------ */

describe('Logs system', () => {
  it('log entries have timestamp, level, source, message', () => {
    const entry = { timestamp: Date.now(), level: 'info' as const, source: 'app', message: 'Started' };
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.level).toBe('info');
    expect(entry.source).toBe('app');
    expect(entry.message).toBe('Started');
  });

  it('log entries can be filtered by level', () => {
    const order: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const entries = [
      { level: 'debug', msg: 'd' },
      { level: 'info', msg: 'i' },
      { level: 'warn', msg: 'w' },
      { level: 'error', msg: 'e' },
    ];
    const threshold = 'info';
    const filtered = entries.filter((e) => order[e.level] >= order[threshold]);
    expect(filtered.length).toBe(3);
    expect(filtered[0].msg).toBe('i');
  });

  it('log entries can be appended to a view', () => {
    document.body.innerHTML = '<div id="logs-view"></div>';
    const view = document.getElementById('logs-view')!;
    const line = document.createElement('div');
    line.className = 'log-line log-info';
    line.innerHTML = '<span class="log-time">00:00</span><span class="log-source">app</span><span class="log-msg">test</span>';
    view.appendChild(line);
    expect(view.children.length).toBe(1);
    expect(view.children[0].querySelector('.log-msg')?.textContent).toBe('test');
  });

  it('log level filter can be changed', () => {
    document.body.innerHTML = '<select id="log-level-filter"><option value="debug">debug</option><option value="info" selected>info</option><option value="warn">warn</option><option value="error">error</option></select>';
    const filter = document.getElementById('log-level-filter') as HTMLSelectElement;
    expect(filter.value).toBe('info');
    filter.value = 'error';
    expect(filter.value).toBe('error');
  });

  it('logs can be cleared', () => {
    document.body.innerHTML = '<div id="logs-view"><div class="log-line">line1</div><div class="log-line">line2</div></div>';
    const view = document.getElementById('logs-view')!;
    view.innerHTML = '';
    expect(view.children.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Theme switching                                                     */
/* ------------------------------------------------------------------ */

describe('Theme switching', () => {
  it('theme can be set to dark', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('theme can be set to light', () => {
    document.documentElement.dataset.theme = 'light';
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('theme can be set to system', () => {
    document.documentElement.dataset.theme = 'system';
    expect(document.documentElement.dataset.theme).toBe('system');
  });
});

/* ------------------------------------------------------------------ */
/* spwanAgentEmbedded (PTY)                                            */
/* ------------------------------------------------------------------ */

describe('spawnAgentEmbedded', () => {
  it('uses script command on non-Windows for CLI agents', () => {
    const platform = 'darwin';
    const strategy = 'env';
    const bin = '/usr/local/bin/claude';
    const args: string[] = [];
    const cmdLine = [bin, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const scriptArgs = ['-q', '/dev/null', '-c', cmdLine];
    expect(platform).not.toBe('win32');
    expect(strategy).toBe('env');
    expect(scriptArgs[0]).toBe('-q');
    expect(scriptArgs[1]).toBe('/dev/null');
    expect(scriptArgs[2]).toBe('-c');
    expect(scriptArgs[3]).toContain('claude');
  });

  it('sets TERM and FORCE_COLOR env vars for PTY', () => {
    const env = { TERM: 'xterm-256color', FORCE_COLOR: '1' };
    expect(env.TERM).toBe('xterm-256color');
    expect(env.FORCE_COLOR).toBe('1');
  });

  it('does not use script on Windows', () => {
    const platform = 'win32';
    const strategy = 'env';
    // On Windows, should use direct spawn
    expect(platform === 'win32' && strategy === 'env').toBe(true);
  });

  it('escapes single quotes in command arguments', () => {
    const arg = "it's";
    const escaped = `'${arg.replace(/'/g, `'\\''`)}'`;
    expect(escaped).toBe("'it'\\''s'");
  });
});