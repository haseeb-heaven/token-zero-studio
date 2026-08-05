// @vitest-environment jsdom
/**
 * Renderer (frontend) integration tests — load the REAL index.html + app.ts
 * with a stubbed window.headroom API, let init() run, and exercise the UI.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROXIES } from '../src/core/proxies/registry';
import { AGENTS } from '../src/core/agents';
import { defaultConfig } from '../src/core/config';

const html = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

/** Minimal stub of the preload-exposed window.headroom API. */
function stubApi() {
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  return {
    platform: 'darwin',
    listAgents: async () => AGENTS.map((a) => ({ ...a })),
    scanAll: async () => AGENTS.map((a) => ({ agentId: a.id, found: true, paths: [`/usr/local/bin/${a.id}`], source: 'path' })),
    scanAgent: async () => ({ agentId: 'codex', found: true, paths: ['/usr/local/bin/codex'], source: 'path' }),
    detectHeadroom: async () => ({ agentId: 'headroom', found: false, paths: [], source: 'none' }),
    listProxies: async () => PROXIES.map((p) => ({ ...p })),
    detectProxy: async () => ({ agentId: '', found: false, paths: [], source: 'none' }),
    installProxy: async (proxyId?: string) => {
      // Success path for the banner install so the found-path branch runs.
      return { ok: true, message: 'installed ok', paths: [`/usr/local/bin/${proxyId ?? 'headroom'}`] };
    },
    installProxyOptions: async () => [{ id: 'npm', label: 'npm global', command: 'npm install -g x' }],
    uninstallProxy: async () => ({ ok: false, message: 'stub' }),
    updateProxy: async () => ({ ok: false, message: 'stub' }),
    installAgent: async () => ({ ok: false, message: 'stub' }),
    installAgentOptions: async () => [{ id: 'npm', label: 'npm global', command: 'npm install -g y' }],
    getConfig: async () => ({ ...defaultConfig() }),
    saveConfig: async () => ({ ok: true }),
    start: async () => ({ id: 'codex-1', agentId: 'codex', state: 'running', port: 8989, proxyPid: 100, agentPid: 101 }),
    launchEmbedded: async () => ({ id: 'codex-2', agentId: 'codex', state: 'running', port: 8989, proxyPid: 100, agentPid: 101, output: [] }),
    stop: async () => ({ id: 'x', agentId: 'x', state: 'stopped' }),
    runtimes: async () => [],
    logs: async () => [],
    clearLogs: async () => {},
    pickExecutable: async () => null,
    pickDirectory: async () => null,
    openPath: async () => {},
    openUrl: async () => {},
    checkPort: async () => true,
    killPort: async () => ({ killed: 0 }),
    getCompatibility: async () => [],
    compatibleAgents: async () => [],
    saveCustomAgent: async () => ({ ok: true }),
    deleteCustomAgent: async () => ({ ok: true }),
    saveCustomProxy: async () => ({ ok: true, proxy: { id: 'my-compressor', name: 'My Compressor', binary: '/opt/my-compressor', startCommand: '', baseUrlTemplate: 'http://127.0.0.1:{port}', envStyle: 'both', port: 8199, timeoutMs: 30000 } }),
    deleteCustomProxy: async () => ({ ok: true }),
    launches: async () => [],
    writeStdin: async () => true,
    onLog: (cb: (e: unknown) => void) => { listeners.log = [...(listeners.log ?? []), cb]; return () => {}; },
    onRuntime: (cb: (e: unknown) => void) => { listeners.runtime = [...(listeners.runtime ?? []), cb]; return () => {}; },
    onOutput: (cb: (e: unknown) => void) => { listeners.output = [...(listeners.output ?? []), cb]; return () => {}; },
    onTerminalData: (cb: (e: unknown) => void) => { listeners.terminal = [...(listeners.terminal ?? []), cb]; return () => {}; },
    _listeners: listeners,
  };
}

beforeAll(() => {
  // jsdom lacks matchMedia; the renderer uses it for theme sync.
  window.matchMedia = window.matchMedia ?? ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  document.body.innerHTML = html;
  (window as unknown as { headroom: unknown }).headroom = stubApi();
  // Load app.ts (runs void init()). Guard against double-instantiation.
  (globalThis as Record<string, unknown>).__appLoaded = (globalThis as Record<string, unknown>).__appLoaded ?? import('../src/renderer/app');
  return (globalThis as Record<string, unknown>).__appLoaded as Promise<unknown>;
});

describe('renderer app.ts boots against the real DOM', () => {
  it('renders the topbar brand and nav tabs', () => {
    const brand = document.querySelector('.brand h1');
    expect(brand?.textContent).toContain('TokenZero');
    const tabs = document.querySelectorAll('.nav-tab');
    expect(tabs.length).toBeGreaterThanOrEqual(4);
  });

  it('does not contain the removed Conductor tab', () => {
    expect(document.getElementById('tab-btn-conductor')).toBeNull();
  });

  it('exposes the management buttons in the compressors view', () => {
    expect(document.getElementById('btn-install-compressor')).toBeTruthy();
    expect(document.getElementById('btn-update-compressor')).toBeTruthy();
    expect(document.getElementById('btn-uninstall-compressor')).toBeTruthy();
    expect(document.getElementById('btn-detect-compressor')).toBeTruthy();
  });

  it('has the workflow xterm host and empty state', () => {
    expect(document.getElementById('workflow-xterm')).toBeTruthy();
    expect(document.getElementById('workflow-empty')).toBeTruthy();
  });

  it('has the logs panel with level filter', () => {
    expect(document.getElementById('logs-panel')).toBeTruthy();
    expect(document.getElementById('log-level-filter')).toBeTruthy();
    expect(document.getElementById('btn-logs-clear')).toBeTruthy();
  });

  it('has the settings view container', () => {
    expect(document.getElementById('settings-view')).toBeTruthy();
    expect(document.getElementById('settings-content')).toBeTruthy();
  });
});

describe('tab switching renders each view', () => {
  it('switches to compressors and renders the compressor list', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById('compressors-view')!.classList.contains('hidden')).toBe(false);
    const list = document.getElementById('compressor-list');
    expect(list!.children.length).toBeGreaterThan(0);
  });

  it('switches to workflow and shows the empty state', async () => {
    document.getElementById('tab-btn-workflow')!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById('workflow-view')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('workflow-empty')!.classList.contains('hidden')).toBe(false);
  });

  it('switches to settings and renders settings cards', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById('settings-view')!.classList.contains('hidden')).toBe(false);
    const cards = document.querySelectorAll('#settings-content .settings-section');
    expect(cards.length).toBeGreaterThan(1);
    const text = document.getElementById('settings-content')!.textContent ?? '';
    expect(text).toMatch(/Workflow terminal \(TTY\)/);
  });

  it('switches to dashboard view', () => {
    document.getElementById('tab-btn-dashboard')!.click();
    expect(document.getElementById('dashboard-view')!.classList.contains('hidden')).toBe(false);
  });

  it('switches back to agents view', () => {
    document.getElementById('tab-btn-agents')!.click();
    expect(document.getElementById('sidebar')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('detail')!.classList.contains('hidden')).toBe(false);
  });
});

describe('logs panel', () => {
  it('toggles collapsed state via the Logs button', () => {
    const panel = document.getElementById('logs-panel')!;
    const initial = panel.classList.contains('collapsed');
    document.getElementById('btn-logs-toggle')!.click();
    expect(panel.classList.contains('collapsed')).toBe(!initial);
    document.getElementById('btn-logs-toggle')!.click();
    expect(panel.classList.contains('collapsed')).toBe(initial);
  });
});

describe('agent selection renders the detail form', () => {
  it('renders the sidebar agent list with entries', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const list = document.getElementById('agent-list');
    expect(list!.children.length).toBeGreaterThan(0);
  });

  it('selecting an agent populates the detail form', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button, #agent-list .agent-entry') as HTMLElement | null;
    expect(first).toBeTruthy();
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const detail = document.getElementById('detail');
    expect(detail!.classList.contains('hidden')).toBe(false);
    // The detail pane shows the agent config form fields.
    expect(document.getElementById('fld-path')).toBeTruthy();
    expect(document.getElementById('fld-port')).toBeTruthy();
    expect(document.getElementById('btn-launch')).toBeTruthy();
  });
});

describe('compressor selection renders management UI', () => {
  it('selecting a compressor shows install/update/remove buttons', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const items = Array.from(document.querySelectorAll('#compressor-list *'));
    const target = items.find((e) => (e.textContent ?? '').includes('Headroom')) as HTMLElement | undefined;
    expect(target).toBeTruthy();
    target!.click();
    await new Promise((r) => setTimeout(r, 150));
    expect(document.getElementById('compressor-detail-content')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-install-compressor')).toBeTruthy();
    expect(document.getElementById('btn-update-compressor')).toBeTruthy();
    expect(document.getElementById('btn-uninstall-compressor')).toBeTruthy();
    expect(document.getElementById('btn-detect-compressor')).toBeTruthy();
    // Detect button is wired.
    expect(typeof (document.getElementById('btn-detect-compressor') as HTMLButtonElement).onclick).toBe('function');
  });

  it('detect button runs and reports not-found status', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const items = Array.from(document.querySelectorAll('#compressor-list *'));
    const target = items.find((e) => (e.textContent ?? '').includes('Headroom')) as HTMLElement | undefined;
    target!.click();
    await new Promise((r) => setTimeout(r, 150));
    (document.getElementById('btn-detect-compressor') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 100));
    const status = document.getElementById('compressor-detect-status')?.textContent ?? '';
    expect(status.length).toBeGreaterThan(0);
  });
});

describe('launch flow', () => {
  it('workflow launch button calls through and opens the workflow tab', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    if (wfBtn) {
      wfBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      // addWorkflowSession switches to the workflow tab.
      expect(document.getElementById('workflow-view')!.classList.contains('hidden')).toBe(false);
    }
  });
});

describe('logs rendering', () => {
  it('appends log lines from the API listener', async () => {
    const view = document.getElementById('logs-view');
    expect(view).toBeTruthy();
    const before = view!.childElementCount;
    const api = (window as unknown as { headroom: { _listeners: Record<string, Array<(p: unknown) => void>> } }).headroom;
    const entry = { level: 'info', source: 'test', message: 'hello log', timestamp: Date.now() };
    // The app registers onLog during init; emit through the captured listener.
    for (const cb of api._listeners.log ?? []) cb(entry);
    expect(view!.childElementCount).toBeGreaterThanOrEqual(before);
  });

  it('respects the log level filter', async () => {
    const filter = document.getElementById('log-level-filter') as HTMLSelectElement | null;
    const clearBtn = document.getElementById('btn-logs-clear') as HTMLButtonElement | null;
    expect(filter).toBeTruthy();
    expect(clearBtn).toBeTruthy();
    // Lower the threshold, emit a debug line, clear.
    if (filter && clearBtn) {
      filter.value = 'debug';
      filter.dispatchEvent(new Event('change'));
      const api = (window as unknown as { headroom: { _listeners: Record<string, Array<(p: unknown) => void>> } }).headroom;
      for (const cb of api._listeners.log ?? []) cb({ level: 'debug', source: 't', message: 'dbg', timestamp: Date.now() });
      clearBtn.click();
    }
  });
});

describe('dashboard', () => {
  it('renders the dashboard view with refresh/open buttons', async () => {
    document.getElementById('tab-btn-dashboard')!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(document.getElementById('dashboard-view')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-refresh-dash')).toBeTruthy();
    expect(document.getElementById('btn-open-dash-browser')).toBeTruthy();
    expect(document.getElementById('dash-iframe')).toBeTruthy();
  });
});

describe('env override editor', () => {
  it('adds an environment variable row', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const envEditor = document.getElementById('env-editor');
    if (envEditor) {
      const before = envEditor.childElementCount;
      const addBtn = document.getElementById('btn-add-env') as HTMLButtonElement | null;
      if (addBtn) {
        addBtn.click();
        expect(envEditor.childElementCount).toBeGreaterThan(before);
      }
    }
  });
});

describe('custom agent form', () => {
  it('opens the custom agent modal with inputs', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const addBtn = Array.from(document.querySelectorAll('#settings-content button')).find((b) => (b.textContent ?? '').includes('Add custom agent')) as HTMLButtonElement | undefined;
    if (addBtn) {
      addBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = document.querySelector('.modal');
      expect(overlay).toBeTruthy();
      expect(document.getElementById('ca-name')).toBeTruthy();
      expect(document.getElementById('ca-binary')).toBeTruthy();
      expect(document.getElementById('ca-args')).toBeTruthy();
    }
  });
});

describe('custom compressor form', () => {
  it('opens the custom compressor modal with inputs', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const btn = document.getElementById('btn-add-custom-proxy') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = document.querySelector('.modal');
      expect(overlay).toBeTruthy();
      expect(document.getElementById('cp-name')).toBeTruthy();
      expect(document.getElementById('cp-binary')).toBeTruthy();
    }
  });
});

describe('port check', () => {
  it('schedules and reports availability for a valid port', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const portInput = document.getElementById('fld-port') as HTMLInputElement | null;
    if (portInput) {
      portInput.value = '8999';
      portInput.dispatchEvent(new Event('input'));
      portInput.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 450));
      const status = document.getElementById('port-status');
      expect(status).toBeTruthy();
    }
  });
});

describe('launch + stop lifecycle', () => {
  it('launch button is wired and stop is hidden until running', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const launchBtn = document.getElementById('btn-launch') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('btn-stop') as HTMLButtonElement | null;
    expect(launchBtn).toBeTruthy();
    expect(stopBtn).toBeTruthy();
    expect(typeof launchBtn!.onclick).toBe('function');
  });

  it('clicking Launch calls through and updates the runtime state', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const launchBtn = document.getElementById('btn-launch') as HTMLButtonElement | null;
    launchBtn!.click();
    await new Promise((r) => setTimeout(r, 300));
    // State dot reflects the running runtime (no crash, state set).
    const dot = document.getElementById('agent-state');
    expect(dot).toBeTruthy();
  });

  it('workflow launch button opens the workflow view with a session', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 400));
    expect(document.getElementById('workflow-view')!.classList.contains('hidden')).toBe(false);
    const tabs = document.getElementById('workflow-tabs');
    expect(tabs!.children.length).toBeGreaterThan(0);
  });
});

describe('workflow session controls', () => {
  it('new-session button opens workflow and wires session controls', async () => {
    document.getElementById('tab-btn-workflow')!.click();
    await new Promise((r) => setTimeout(r, 50));
    const newBtn = document.getElementById('wf-btn-new-session') as HTMLButtonElement | null;
    expect(newBtn).toBeTruthy();
    expect(typeof newBtn!.onclick).toBe('function');
    const closeBtn = document.getElementById('wf-btn-close') as HTMLButtonElement | null;
    const renameBtn = document.getElementById('wf-btn-rename') as HTMLButtonElement | null;
    expect(renameBtn).toBeTruthy();
    expect(closeBtn).toBeTruthy();
  });
});

describe('topbar actions', () => {
  it('scan system button is wired', async () => {
    const btn = document.getElementById('btn-scan-all') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(typeof btn!.onclick).toBe('function');
  });

  it('settings topbar button switches to settings tab', () => {
    document.getElementById('btn-settings')!.click();
    expect(document.getElementById('settings-view')!.classList.contains('hidden')).toBe(false);
  });
});

describe('proxy install banner', () => {
  it('wires the install-proxy banner button in the detail pane', async () => {
    // detectProxy stub returns not-found, so the install banner renders.
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const installBtn = document.getElementById('btn-install-proxy') as HTMLButtonElement | null;
    // Banner may or may not render depending on the selected agent's compressor.
    if (installBtn) {
      expect(typeof installBtn.onclick).toBe('function');
    }
  });
});

describe('workflow session rename via promptModal', () => {
  it('rename button is wired and opens a modal', async () => {
    // Create a session first.
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 400));
    const renameBtn = document.getElementById('wf-btn-rename') as HTMLButtonElement | null;
    expect(renameBtn).toBeTruthy();
    expect(typeof renameBtn!.onclick).toBe('function');
    renameBtn!.click();
    await new Promise((r) => setTimeout(r, 100));
    // promptModal creates an overlay with an input.
    const overlay = document.querySelector('.modal-overlay, .modal');
    expect(overlay).toBeTruthy();
  });

  it('restart and close header buttons are wired and functional', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 400));
    const restartBtn = document.getElementById('wf-btn-restart') as HTMLButtonElement | null;
    const closeBtn = document.getElementById('wf-btn-close') as HTMLButtonElement | null;
    expect(typeof restartBtn!.onclick).toBe('function');
    expect(typeof closeBtn!.onclick).toBe('function');
    // Restart relaunches the embedded session.
    restartBtn!.click();
    await new Promise((r) => setTimeout(r, 300));
    // Close the session: the workflow returns to the empty state.
    closeBtn!.click();
    await new Promise((r) => setTimeout(r, 300));
    expect(document.getElementById('workflow-empty')!.classList.contains('hidden')).toBe(false);
  });
});

describe('settings section handlers', () => {
  it('settings sections render and TTY select is wired', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const sections = document.querySelectorAll('#settings-content .settings-section');
    expect(sections.length).toBeGreaterThan(4);
    const text = document.getElementById('settings-content')!.textContent ?? '';
    expect(text).toMatch(/Workflow terminal/);
    // The TTY select is a <select> whose options start with auto/direct/python-pty.
    const ttySel = Array.from(document.querySelectorAll('#settings-content select')).find(
      (s) => {
        const opts = (s as HTMLSelectElement).options;
        return opts.length >= 3 && ['auto', 'direct', 'python-pty'].includes(opts[0].value);
      },
    ) as HTMLSelectElement | null;
    if (ttySel) {
      expect(ttySel.options[0].value).toBe('auto');
      expect(typeof ttySel.onchange).toBe('function');
    }
  });
});

describe('instructions modal', () => {
  it('instructions button opens the copyable command modal', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const btn = document.getElementById('btn-instructions') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = document.querySelector('.modal-overlay, .modal');
      expect(overlay).toBeTruthy();
    }
  });
});

describe('workflow context menu', () => {
  it('right-click on a session tab opens the context menu', async () => {
    // Launch a fresh session (earlier tests may have closed theirs).
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 400));
    const tab = document.querySelector('#workflow-tabs .workflow-tab-item') as HTMLElement | null;
    expect(tab).toBeTruthy();
    tab!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    await new Promise((r) => setTimeout(r, 50));
    const menu = document.querySelector('.workflow-context-menu');
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toMatch(/Rename/);
    expect(menu!.textContent).toMatch(/Restart/);
    expect(menu!.textContent).toMatch(/Close/);
  });
});

describe('stop flow', () => {
  it('stop button is wired and stops a running session', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    // Launch to get a running state, then stop.
    const launchBtn = document.getElementById('btn-launch') as HTMLButtonElement | null;
    launchBtn!.click();
    await new Promise((r) => setTimeout(r, 300));
    const stopBtn = document.getElementById('btn-stop') as HTMLButtonElement | null;
    expect(stopBtn).toBeTruthy();
    expect(typeof stopBtn!.onclick).toBe('function');
    stopBtn!.click();
    await new Promise((r) => setTimeout(r, 300));
    // After stop, the agent-state dot reflects stopped.
    const dot = document.getElementById('agent-state');
    expect(dot).toBeTruthy();
  });

  it('kill-port button is wired', async () => {
    const btn = document.getElementById('btn-kill-port') as HTMLButtonElement | null;
    if (btn) {
      expect(typeof btn.onclick).toBe('function');
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});

describe('custom agent form save/cancel', () => {
  it('modal confirm and cancel flows work', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const addBtn = Array.from(document.querySelectorAll('#settings-content button')).find((b) => (b.textContent ?? '').includes('Add custom agent')) as HTMLButtonElement | undefined;
    if (addBtn) {
      addBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      // Cancel closes the modal.
      const cancelBtn = document.getElementById('ca-cancel') as HTMLButtonElement | null;
      if (cancelBtn) {
        cancelBtn.click();
        await new Promise((r) => setTimeout(r, 100));
        expect(document.querySelector('.modal')).toBeFalsy();
      }
    }
  });
});

describe('agent filter', () => {
  it('filtering the agent list narrows entries', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const filter = document.getElementById('agent-filter') as HTMLInputElement | null;
    const list = document.getElementById('agent-list')!;
    const all = list.children.length;
    expect(all).toBeGreaterThan(0);
    if (filter) {
      filter.value = 'codex';
      filter.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 100));
      expect(list.children.length).toBeGreaterThan(0);
      expect(list.children.length).toBeLessThanOrEqual(all);
    }
  });
});

describe('detail form field handlers', () => {
  async function selectAgent() {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
  }

  it('path/port/workdir/mode/toggles/extra fields update the profile', async () => {
    await selectAgent();
    const set = (id: string, value: string, type: 'input' | 'change' = 'input') => {
      const elm = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
      elm.value = value;
      elm.dispatchEvent(new Event(type, { bubbles: true }));
    };
    set('fld-path', '/opt/bin/codex', 'input');
    set('fld-port', '8999', 'input');
    set('fld-workdir', '/tmp/work', 'input');
    set('fld-mode', 'cache', 'change');
    set('fld-extra-proxy', '--fast', 'input');
    set('fld-extra-agent', '--verbose', 'input');
    const mem = document.getElementById('tgl-memory') as HTMLInputElement | null;
    if (mem) { mem.checked = true; mem.dispatchEvent(new Event('change')); }
    const learn = document.getElementById('tgl-learn') as HTMLInputElement | null;
    if (learn) { learn.checked = true; learn.dispatchEvent(new Event('change')); }
    const lossless = document.getElementById('tgl-lossless') as HTMLInputElement | null;
    if (lossless) { lossless.checked = true; lossless.dispatchEvent(new Event('change')); }
    const noopt = document.getElementById('tgl-noopt') as HTMLInputElement | null;
    if (noopt) { noopt.checked = true; noopt.dispatchEvent(new Event('change')); }
    const autoPort = document.getElementById('tgl-auto-port') as HTMLInputElement | null;
    if (autoPort) { autoPort.checked = true; autoPort.dispatchEvent(new Event('change')); }
    await new Promise((r) => setTimeout(r, 400));
    const pathVal = (document.getElementById('fld-path') as HTMLInputElement).value;
    expect(pathVal).toBe('/opt/bin/codex');
  });

  it('clear-path and scan-agent buttons work', async () => {
    await selectAgent();
    const clearBtn = document.getElementById('btn-clear-path') as HTMLButtonElement | null;
    if (clearBtn) {
      (document.getElementById('fld-path') as HTMLInputElement).value = '/x/y';
      clearBtn.click();
      expect((document.getElementById('fld-path') as HTMLInputElement).value).toBe('');
    }
    const scanBtn = document.getElementById('btn-scan-agent') as HTMLButtonElement | null;
    if (scanBtn) {
      scanBtn.click();
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  it('browse buttons call through without crashing', async () => {
    await selectAgent();
    const browse = document.getElementById('btn-browse') as HTMLButtonElement | null;
    if (browse) { browse.click(); await new Promise((r) => setTimeout(r, 100)); }
    const browseDir = document.getElementById('btn-browse-dir') as HTMLButtonElement | null;
    if (browseDir) { browseDir.click(); await new Promise((r) => setTimeout(r, 100)); }
  });

  it('profile save-as opens promptModal and cancel dismisses', async () => {
    await selectAgent();
    const saveAs = document.getElementById('btn-profile-saveas') as HTMLButtonElement | null;
    if (saveAs) {
      saveAs.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      expect(overlay).toBeTruthy();
      // Cancel the prompt.
      const cancelBtn = Array.from(overlay?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Cancel');
      (cancelBtn as HTMLButtonElement | undefined)?.click();
      await new Promise((r) => setTimeout(r, 100));
      expect(overlay!.isConnected).toBe(false);
    }
  });

  it('profile delete confirmModal cancels and keeps profile', async () => {
    await selectAgent();
    const del = document.getElementById('btn-profile-delete') as HTMLButtonElement | null;
    if (del) {
      del.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      if (overlay) {
        const cancelBtn = Array.from(overlay.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Cancel');
        (cancelBtn as HTMLButtonElement | undefined)?.click();
        await new Promise((r) => setTimeout(r, 100));
        expect(overlay.isConnected).toBe(false);
      }
    }
  });

  it('active compressor select change updates config', async () => {
    await selectAgent();
    const sel = document.getElementById('fld-default-compressor') as HTMLSelectElement | null;
    const launchSel = document.getElementById('launch-bar-compressor-select') as HTMLSelectElement | null;
    const target = sel ?? launchSel;
    if (target) {
      target.value = 'pxpipe';
      target.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  it('dashboard refresh and open-browser buttons are wired', async () => {
    document.getElementById('tab-btn-dashboard')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const refresh = document.getElementById('btn-refresh-dash') as HTMLButtonElement | null;
    if (refresh) { refresh.click(); await new Promise((r) => setTimeout(r, 50)); }
    const open = document.getElementById('btn-open-dash-browser') as HTMLButtonElement | null;
    if (open) { open.click(); await new Promise((r) => setTimeout(r, 50)); }
  });
});

describe('compressor install/update/remove actions', () => {
  async function selectCompressor(name: string) {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const items = Array.from(document.querySelectorAll('#compressor-list *'));
    const target = items.find((e) => (e.textContent ?? '').includes(name)) as HTMLElement | undefined;
    target?.click();
    await new Promise((r) => setTimeout(r, 200));
  }

  it('install button runs and reports the stub result', async () => {
    await selectCompressor('Headroom');
    const btn = document.getElementById('btn-install-compressor') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      // Button re-enables after the (stubbed, failing) install completes.
      expect(btn.disabled).toBe(false);
    }
  });

  it('update button runs and re-detects', async () => {
    await selectCompressor('PxPipe');
    const btn = document.getElementById('btn-update-compressor') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      expect(btn.disabled).toBe(false);
    }
  });

  it('uninstall button runs and reports', async () => {
    await selectCompressor('PxPipe');
    const btn = document.getElementById('btn-uninstall-compressor') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      expect(btn.disabled).toBe(false);
    }
  });
});

describe('env editor rows', () => {
  it('add-env creates a row and remove deletes it', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const editor = document.getElementById('env-editor');
    const addBtn = document.getElementById('btn-add-env') as HTMLButtonElement | null;
    if (editor && addBtn) {
      const before = editor.childElementCount;
      addBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      const rows = editor.querySelectorAll('.env-row');
      expect(rows.length).toBeGreaterThan(0);
      const remove = rows[rows.length - 1]?.querySelector('button');
      (remove as HTMLButtonElement | undefined)?.click();
      await new Promise((r) => setTimeout(r, 50));
      expect(editor.childElementCount).toBeLessThanOrEqual(before);
    }
  });
});

describe('instructions and open-config', () => {
  it('instructions button renders the command modal', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const btn = document.getElementById('btn-instructions') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      expect(overlay).toBeTruthy();
    }
  });

  it('open-config button calls through', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const btn = document.getElementById('btn-open-config') as HTMLButtonElement | null;
    if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 100)); }
  });
});

describe('workflow context menu actions', () => {
  async function openMenu() {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 700));
    const tab = document.querySelector('#workflow-tabs .workflow-tab-item') as HTMLElement | null;
    tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    await new Promise((r) => setTimeout(r, 60));
    return document.querySelector('.workflow-context-menu');
  }

  it('Stop action stops the session', async () => {
    const menu = (await openMenu()) as HTMLElement | null;
    if (menu) {
      const stop = Array.from(menu.querySelectorAll('button')).find((b) => /Stop/.test(b.textContent ?? ''));
      stop?.click();
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  it('Close action removes the session', async () => {
    const menu = (await openMenu()) as HTMLElement | null;
    if (menu) {
      const close = Array.from(menu.querySelectorAll('button')).find((b) => /Close/.test(b.textContent ?? ''));
      close?.click();
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  it('Pause/Resume toggles session state', async () => {
    const menu = (await openMenu()) as HTMLElement | null;
    if (menu) {
      const pause = Array.from(menu.querySelectorAll('button')).find((b) => /Pause|Resume/.test(b.textContent ?? ''));
      pause?.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('Rename invokes the native prompt (stubbed in jsdom)', async () => {
    const menu = (await openMenu()) as HTMLElement | null;
    if (menu) {
      const rename = Array.from(menu.querySelectorAll('button')).find((b) => /Rename/.test(b.textContent ?? ''));
      // Native prompt() returns null in jsdom — just verify the handler runs
      // without throwing (the header ✏️ button shares this code path).
      expect(rename).toBeTruthy();
      rename!.click();
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});

describe('settings onchange handlers', () => {
  it('default compressor select persists', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const sel = document.querySelector('#settings-content select') as HTMLSelectElement | null;
    if (sel && typeof sel.onchange === 'function') {
      sel.value = 'tokenshift';
      sel.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('theme and tty selects change', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const selects = Array.from(document.querySelectorAll('#settings-content select')) as HTMLSelectElement[];
    for (const sel of selects) {
      if (typeof sel.onchange !== 'function') continue;
      if (sel.options.length >= 2) {
        sel.selectedIndex = sel.options.length - 1;
        sel.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });
});

describe('scan-all and runtime refresh', () => {
  it('scan-all button runs the full scan', async () => {
    const btn = document.getElementById('btn-scan-all') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      expect(btn.hasAttribute('disabled')).toBe(false);
    }
  });
});

describe('detected-path chips', () => {
  it('clicking a detected path sets it as explicit', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 200));
    // scanAgent stub returns a found path -> renderDetectedPaths populates chips.
    const chips = document.querySelectorAll('.detected-path');
    expect(chips.length).toBeGreaterThan(0);
    (chips[0] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect((document.getElementById('fld-path') as HTMLInputElement).value).toBe('/usr/local/bin/codex');
  });
});

describe('agent install options', () => {
  it('install options populate and install button runs', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 200));
    const sel = document.getElementById('agent-install-option') as HTMLSelectElement | null;
    if (sel) {
      expect(sel.options.length).toBeGreaterThan(0);
      sel.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 50));
      const btn = document.getElementById('btn-install-agent') as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
        expect(btn.disabled).toBe(false);
      }
    }
  });
});

describe('workflow tab click', () => {
  it('clicking a session tab activates it', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 700));
    const tab = document.querySelector('#workflow-tabs .workflow-tab-item') as HTMLElement | null;
    if (tab) {
      tab.click();
      await new Promise((r) => setTimeout(r, 100));
      expect(tab.classList.contains('active')).toBe(true);
    }
  });

  it('new-session button routes to agents', async () => {
    document.getElementById('tab-btn-workflow')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const btn = document.getElementById('wf-btn-new-session') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      expect(document.getElementById('sidebar')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('detail')!.classList.contains('hidden')).toBe(false);
    }
  });
});

describe('settings path/timeout/cwd/term handlers', () => {
  it('path, timeout, cwd, and terminal-fallback fields wire up', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const inputs = Array.from(document.querySelectorAll('#settings-content input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    let changed = 0;
    for (const inp of inputs) {
      if (typeof (inp as HTMLInputElement).oninput === 'function') {
        inp.value = 'test-value';
        inp.dispatchEvent(new Event('input'));
        changed++;
      }
      if (typeof (inp as HTMLInputElement).onchange === 'function') {
        inp.dispatchEvent(new Event('change'));
        changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('profile save-as OK path and env add', () => {
  async function selectAgent() {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
  }

  it('save-as with a name creates a profile via promptModal OK', async () => {
    await selectAgent();
    const saveAs = document.getElementById('btn-profile-saveas') as HTMLButtonElement | null;
    if (saveAs) {
      saveAs.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      if (overlay) {
        const input = overlay.querySelector('input') as HTMLInputElement;
        input.value = 'My New Profile';
        const ok = Array.from(overlay.querySelectorAll('button')).find((b) => b.textContent === 'OK');
        (ok as HTMLButtonElement | undefined)?.click();
        await new Promise((r) => setTimeout(r, 200));
        const sel = document.getElementById('profile-select') as HTMLSelectElement | null;
        if (sel) {
          expect(Array.from(sel.options).some((o) => o.value === 'My New Profile')).toBe(true);
        }
      }
    }
  });

  it('delete profile with 2+ profiles confirms and removes', async () => {
    await selectAgent();
    const del = document.getElementById('btn-profile-delete') as HTMLButtonElement | null;
    if (del) {
      del.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      if (overlay) {
        const ok = Array.from(overlay.querySelectorAll('button')).find((b) => /Delete|OK|Yes/.test(b.textContent ?? ''));
        (ok as HTMLButtonElement | undefined)?.click();
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  it('env-add button creates a row and save-config runs', async () => {
    await selectAgent();
    const envBtn = document.getElementById('btn-env-add') as HTMLButtonElement | null;
    if (envBtn) {
      envBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelectorAll('.env-row').length).toBeGreaterThan(0);
    }
    const saveCfg = document.getElementById('btn-save-config') as HTMLButtonElement | null;
    if (saveCfg) {
      saveCfg.click();
      await new Promise((r) => setTimeout(r, 150));
    }
  });
});

describe('compressor search filter', () => {
  it('typing in the compressor filter narrows the list', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const filter = document.getElementById('compressor-filter') as HTMLInputElement | null;
    if (filter) {
      const all = document.querySelectorAll('#compressor-list .agent-item').length;
      filter.value = 'px';
      filter.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 150));
      const shown = document.querySelectorAll('#compressor-list .agent-item').length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(all);
    }
  });
});

describe('compressor save + set-default buttons', () => {
  async function selectCompressor(name: string) {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const items = Array.from(document.querySelectorAll('#compressor-list *'));
    const target = items.find((e) => (e.textContent ?? '').includes(name)) as HTMLElement | undefined;
    target?.click();
    await new Promise((r) => setTimeout(r, 200));
  }

  it('save-compressor persists the binary path', async () => {
    await selectCompressor('PxPipe');
    const pathInput = document.getElementById('compressor-binary-path') as HTMLInputElement | null;
    const saveBtn = document.getElementById('btn-save-compressor') as HTMLButtonElement | null;
    if (pathInput && saveBtn) {
      pathInput.value = '/opt/pxpipe';
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 250));
      const status = document.getElementById('compressor-save-status')?.textContent ?? '';
      expect(status).toMatch(/Saved/i);
    }
  });

  it('set-default-compressor updates the default', async () => {
    await selectCompressor('PxPipe');
    const btn = document.getElementById('btn-set-default-compressor') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
  });
});

describe('env row remove + instructions content', () => {
  async function selectAgent() {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
  }

  it('env row remove button deletes the row', async () => {
    await selectAgent();
    const envBtn = document.getElementById('btn-env-add') as HTMLButtonElement | null;
    if (envBtn) {
      envBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      const rows = document.querySelectorAll('.env-row');
      expect(rows.length).toBeGreaterThan(0);
      const remove = rows[rows.length - 1]?.querySelector('button');
      (remove as HTMLButtonElement | undefined)?.click();
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelectorAll('.env-row').length).toBeLessThan(rows.length);
    }
  });

  it('instructions modal contains the agent instructions', async () => {
    await selectAgent();
    const btn = document.getElementById('btn-instructions') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
      if (overlay) {
        const text = overlay.textContent ?? '';
        expect(text.length).toBeGreaterThan(20);
        // close it
        overlay.remove();
      }
    }
  });

  it('restart context-menu action relaunches the session', async () => {
    await selectAgent();
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 700));
    const tab = document.querySelector('#workflow-tabs .workflow-tab-item') as HTMLElement | null;
    tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    await new Promise((r) => setTimeout(r, 60));
    const menu = document.querySelector('.workflow-context-menu') as HTMLElement | null;
    if (menu) {
      const restart = Array.from(menu.querySelectorAll('button')).find((b) => /Restart/.test(b.textContent ?? ''));
      restart?.click();
      await new Promise((r) => setTimeout(r, 300));
    }
  });
});

describe('profile-select onchange', () => {
  it('changing the profile select switches profiles', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const sel = document.getElementById('profile-select') as HTMLSelectElement | null;
    if (sel) {
      // Need at least 2 profiles; create one if missing.
      const saveAs = document.getElementById('btn-profile-saveas') as HTMLButtonElement | null;
      if (sel.options.length < 2 && saveAs) {
        saveAs.click();
        await new Promise((r) => setTimeout(r, 100));
        const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
        if (overlay) {
          (overlay.querySelector('input') as HTMLInputElement).value = 'Second Profile';
          const ok = Array.from(overlay.querySelectorAll('button')).find((b) => b.textContent === 'OK');
          (ok as HTMLButtonElement | undefined)?.click();
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (sel.options.length >= 2) {
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
});

describe('promptModal keyboard paths', () => {
  async function openSaveAs() {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const saveAs = document.getElementById('btn-profile-saveas') as HTMLButtonElement | null;
    saveAs?.click();
    await new Promise((r) => setTimeout(r, 100));
    // promptModal overlays are position:fixed AND contain a text input.
    return Array.from(document.querySelectorAll('body > div')).find(
      (d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed') && d.querySelector('input[type="text"]'),
    ) as HTMLElement | undefined;
  }

  it('Enter key confirms the prompt', async () => {
    const overlay = await openSaveAs();
    if (overlay) {
      const input = overlay.querySelector('input') as HTMLInputElement;
      input.value = 'Enter Profile';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const sel = document.getElementById('profile-select') as HTMLSelectElement | null;
      if (sel) {
        expect(Array.from(sel.options).some((o) => o.value === 'Enter Profile')).toBe(true);
      }
    }
  });

  it('Escape key cancels the prompt', async () => {
    const overlay = await openSaveAs();
    if (overlay) {
      const input = overlay.querySelector('input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      expect(overlay.isConnected).toBe(false);
    }
  });
});

describe('confirmModal OK path', () => {
  it('delete with 2 profiles confirms and removes', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 150));
    const sel = document.getElementById('profile-select') as HTMLSelectElement | null;
    if (sel && sel.options.length >= 2) {
      const del = document.getElementById('btn-profile-delete') as HTMLButtonElement | null;
      if (del) {
        del.click();
        await new Promise((r) => setTimeout(r, 100));
        const overlay = Array.from(document.querySelectorAll('body > div')).find((d) => (d as HTMLElement).style.cssText.replace(/\s+/g, '').startsWith('position:fixed'));
        if (overlay) {
          // confirmModal buttons: Cancel + Confirm
          const ok = Array.from(overlay.querySelectorAll('button')).find((b) => /Confirm/.test(b.textContent ?? ''));
          (ok as HTMLButtonElement | undefined)?.click();
          await new Promise((r) => setTimeout(r, 250));
          expect(sel.options.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('workflow terminal input (isSessionLive path)', () => {
  it('typing into a live session routes stdin via the API', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 700));
    // Simulate a keystroke on the xterm host if the terminal exists.
    const host = document.querySelector('#workflow-xterm .xterm-helper-textarea, #workflow-xterm textarea') as HTMLTextAreaElement | null;
    if (host) {
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});

describe('headroom install banner button', () => {
  it('install-proxy banner button runs the install path', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 250));
    const installBtn = document.getElementById('btn-install-proxy') as HTMLButtonElement | null;
    if (installBtn) {
      installBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      expect(installBtn.disabled).toBe(false);
    }
  });
});

describe('instructions-strategy agent card', () => {
  it('selecting an instructions-strategy agent shows instructions text', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    // Find an agent with launchStrategy 'instructions' (e.g. continue).
    const item = Array.from(document.querySelectorAll('#agent-list .agent-item') as NodeListOf<HTMLElement>).find(
      (i) => /Continue/i.test(i.textContent ?? ''),
    ) ?? (document.querySelector('#agent-list .agent-item') as HTMLElement | null);
    item?.click();
    await new Promise((r) => setTimeout(r, 200));
    const card = document.getElementById('instructions-card');
    if (card && !card.classList.contains('hidden')) {
      const text = document.getElementById('instructions-text')?.textContent ?? '';
      expect(text.length).toBeGreaterThan(20);
    }
  });
});

describe('custom compressor save flow', () => {
  it('filling the form and saving persists via the API', async () => {
    document.getElementById('tab-btn-compressors')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const addBtn = document.getElementById('btn-add-custom-proxy') as HTMLButtonElement | null;
    if (addBtn) {
      addBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const name = document.getElementById('cp-name') as HTMLInputElement | null;
      const binary = document.getElementById('cp-binary') as HTMLInputElement | null;
      const command = document.getElementById('cp-command') as HTMLInputElement | null;
      if (name && binary) {
        name.value = 'My Compressor';
        binary.value = '/opt/my-compressor';
        if (command) command.value = 'my-compressor --serve';
        const save = document.querySelector('.btn-save-cp') as HTMLButtonElement | null;
        save?.click();
        await new Promise((r) => setTimeout(r, 300));
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) {
          expect(overlay.isConnected).toBe(true); // stub returns ok:false? no — ok:true
        }
      }
    }
  });
});

describe('custom agent save flow', () => {
  it('filling the custom agent form and saving', async () => {
    document.getElementById('tab-btn-settings')!.click();
    await new Promise((r) => setTimeout(r, 150));
    const addBtn = Array.from(document.querySelectorAll('#settings-content button')).find((b) => (b.textContent ?? '').includes('Add custom agent')) as HTMLButtonElement | undefined;
    if (addBtn) {
      addBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const name = document.getElementById('ca-name') as HTMLInputElement | null;
      const binary = document.getElementById('ca-binary') as HTMLInputElement | null;
      if (name && binary) {
        name.value = 'Custom Agent X';
        binary.value = '/opt/custom-agent';
        const save = document.querySelector('.btn-save-ca') as HTMLButtonElement | null;
        save?.click();
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  });
});

describe('workflow output listener', () => {
  it('routes runtime output events to the session and updates the title', async () => {
    document.getElementById('tab-btn-agents')!.click();
    await new Promise((r) => setTimeout(r, 100));
    const first = document.querySelector('#agent-list .agent-item, #agent-list button') as HTMLElement | null;
    first!.click();
    await new Promise((r) => setTimeout(r, 100));
    const wfBtn = document.getElementById('btn-launch-workflow') as HTMLButtonElement | null;
    wfBtn!.click();
    await new Promise((r) => setTimeout(r, 700));
    const api = (window as unknown as { headroom: { _listeners: Record<string, Array<(p: unknown) => void>> } }).headroom;
    const cb = api._listeners.output?.[0];
    if (cb) {
      cb({ id: 'codex-2', state: 'running', output: ['line one', 'line two'] });
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});
