import type { HeadroomApi } from '../preload/index';
import { resolveTheme } from '../core/theme';
import { PROXIES } from '../core/proxies/registry';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type {
  AgentConfig,
  AgentDefinition,
  AgentProfile,
  AgentRuntime,
  AppConfig,
  LogEntry,
  LogLevel,
  RunState,
  ScanResult,
  ThemeMode,
} from '../shared/types';

const api = (window as unknown as { headroom: HeadroomApi }).headroom;

/* ================================ Theme ================================ */

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Apply a theme mode; 'system' tracks the OS preference live. */
function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode, systemThemeQuery.matches);
}

// Provisional theme before config loads (avoids a flash of the wrong theme).
applyTheme('system');

systemThemeQuery.addEventListener('change', () => {
  if (!config || config.theme === 'system') applyTheme('system');
});

/* ================================ State ================================ */

let agents: AgentDefinition[] = [];
let config: AppConfig | null = null;
const scans = new Map<string, ScanResult>();
const runtimes = new Map<string, AgentRuntime>();
let selectedId: string | null = null;
let logThreshold: LogLevel = 'info';
let logEntries: LogEntry[] = [];

const LOG_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const STATE_LABEL: Record<RunState, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  'proxy-up': 'Proxy running',
  running: 'Running',
  stopping: 'Stopping…',
  error: 'Error',
};

let portCheckTimer: ReturnType<typeof setTimeout> | undefined;

/* ============================== DOM helpers ============================= */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const root = el('toast-root');
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function promptModal(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:200';
    const box = document.createElement('div');
    box.style.cssText =
      'background:var(--bg-2);border:1px solid var(--border-strong);border-radius:10px;padding:18px;width:380px;box-shadow:var(--shadow)';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:650;margin-bottom:10px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.style.cssText = 'width:100%;margin-bottom:14px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = 'OK';
    row.append(cancel, ok);
    box.append(h, input, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
    const done = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    cancel.onclick = () => done(null);
    ok.onclick = () => done(input.value.trim() || null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

function confirmModal(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:200';
    const box = document.createElement('div');
    box.style.cssText =
      'background:var(--bg-2);border:1px solid var(--border-strong);border-radius:10px;padding:18px;width:380px;box-shadow:var(--shadow)';
    const h = document.createElement('div');
    h.textContent = message;
    h.style.cssText = 'margin-bottom:16px;line-height:1.5';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'btn btn-danger';
    ok.textContent = 'Confirm';
    row.append(cancel, ok);
    box.append(h, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = (v: boolean) => {
      overlay.remove();
      resolve(v);
    };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
  });
}

/* ============================ Config helpers =========================== */

function agentConfig(agentId: string): AgentConfig {
  return config!.agents.find((a) => a.agentId === agentId)!;
}

function currentProfile(): AgentProfile {
  const ac = agentConfig(selectedId!);
  return ac.profiles.find((p) => p.name === ac.activeProfile) ?? ac.profiles[0];
}

function runtimeFor(agentId: string): AgentRuntime {
  return runtimes.get(agentId) ?? { agentId, state: 'stopped' };
}

async function saveConfig(quiet = false): Promise<boolean> {
  if (!config) return false;
  const result = await api.saveConfig(config);
  if (!result.ok) {
    toast(`Save failed: ${result.error}`, 'err');
    return false;
  }
  if (!quiet) toast('Configuration saved');
  return true;
}

/* ============================== Sidebar ================================ */

function interfaceLabel(agent: AgentDefinition): string {
  return agent.interfaceType === 'cli' ? 'CLI' : agent.interfaceType === 'gui' ? 'GUI' : 'IDE ext';
}

function renderSidebar(filter = ''): void {
  const list = el('agent-list');
  list.innerHTML = '';
  const query = filter.trim().toLowerCase();
  for (const agent of agents) {
    if (query && !agent.name.toLowerCase().includes(query) && !agent.id.includes(query) && !agent.vendor.toLowerCase().includes(query)) {
      continue;
    }
    const scan = scans.get(agent.id);
    const rt = runtimeFor(agent.id);
    const item = document.createElement('div');
    item.className = 'agent-item' + (agent.id === selectedId ? ' selected' : '');
    item.dataset.agentId = agent.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = `linear-gradient(135deg, ${agent.accent}, ${agent.accent}99)`;
    avatar.textContent = agent.name.charAt(0);

    const text = document.createElement('div');
    text.className = 'agent-item-text';
    const name = document.createElement('div');
    name.className = 'agent-item-name';
    name.textContent = agent.name;
    const sub = document.createElement('div');
    sub.className = 'agent-item-sub';
    const detected = scan ? (scan.found ? '✓ detected' : 'not found') : '…';
    sub.textContent = `${agent.vendor} · ${interfaceLabel(agent)} · ${detected}`;
    text.append(name, sub);

    const dot = document.createElement('span');
    dot.className = `state-dot state-${rt.state}`;
    dot.title = STATE_LABEL[rt.state];

    item.append(avatar, text, dot);
    item.onclick = () => selectAgent(agent.id);
    list.appendChild(item);
  }
}

/* ============================ Detail pane ============================== */

function selectAgent(agentId: string): void {
  selectedId = agentId;
  renderSidebar(el<HTMLInputElement>('agent-filter').value);
  renderDetail();
}

function renderDetail(): void {
  const agent = agents.find((a) => a.id === selectedId);
  if (!agent || !config) {
    el('detail-empty').classList.remove('hidden');
    el('detail-content').classList.add('hidden');
    return;
  }
  el('detail-empty').classList.add('hidden');
  el('detail-content').classList.remove('hidden');

  const profile = currentProfile();
  const scan = scans.get(agent.id);
  const rt = runtimeFor(agent.id);

  // header
  const avatar = el('agent-avatar');
  avatar.style.background = `linear-gradient(135deg, ${agent.accent}, ${agent.accent}99)`;
  avatar.textContent = agent.name.charAt(0);
  el('agent-name').textContent = agent.name;
  el('badge-interface').textContent = interfaceLabel(agent);
  el('badge-strategy').textContent = agent.launchStrategy === 'env' ? 'auto-launch' : 'manual setup';
  el('agent-desc').textContent = agent.description;
  el('agent-vendor').textContent = agent.vendor;
  el('agent-wrap-cmd').textContent = `headroom wrap ${agent.id}`;
  el('agent-homepage').textContent = agent.homepage.replace(/^https?:\/\//, '');

  const state = el('agent-state');
  state.className = `state-dot state-${rt.state}`;
  state.title = STATE_LABEL[rt.state];

  // detection banner
  const banner = el('detect-banner');
  if (scan) {
    banner.classList.remove('hidden');
    if (scan.found) {
      banner.className = 'banner banner-ok';
      banner.textContent = `Detected ${scan.paths.length} installation${scan.paths.length > 1 ? 's' : ''} (${scan.source === 'explicit' ? 'explicit path' : scan.source === 'path' ? 'on PATH' : 'well-known location'}): ${scan.paths[0]}`;
    } else {
      banner.className = 'banner banner-warn';
      banner.textContent = `${agent.name} was not found on this system. Install it, or browse to its executable below.`;
    }
  } else {
    banner.classList.add('hidden');
  }

  // profiles
  renderProfileBar();

  // connection fields
  el<HTMLInputElement>('fld-path').value = profile.agentPath;
  el<HTMLInputElement>('fld-port').value = String(profile.port);
  const autoPortToggle = el<HTMLInputElement>('tgl-auto-port');
  if (autoPortToggle) autoPortToggle.checked = profile.autoPort;
  el<HTMLInputElement>('fld-workdir').value = profile.workingDirectory;
  el('agent-config-hint').textContent = agent.configFileHint || '-';
  el('port-status').textContent = '';
  renderDetectedPaths(agent, scan);
  void populateAgentInstallOptions(agent.id);

  // proxy options
  const activeProxyId = config?.defaultCompressor || 'headroom';
  const proxyObj = PROXIES.find((p) => p.id === activeProxyId);
  const activeProxyName = proxyObj?.name || 'Custom';
  const launchBtn = el('btn-launch');
  if (launchBtn) launchBtn.textContent = `▶ Launch ${agent.name} with ${activeProxyName}`;

  const activeSelect = document.getElementById('fld-default-compressor') as HTMLSelectElement | null;
  if (activeSelect) activeSelect.value = activeProxyId;

  const barSelect = el<HTMLSelectElement>('launch-bar-compressor-select');
  if (barSelect) barSelect.value = activeProxyId;

  const descBanner = document.getElementById('proxy-desc-banner');
  if (descBanner) {
    if (activeProxyId === 'headroom') {
      descBanner.textContent = 'Headroom: Context freezing & LLM token compression proxy with prefix-cache optimizations.';
    } else if (activeProxyId === 'rtk') {
      descBanner.textContent = 'RTK (Rust Token Killer): Shell command output compressor. Runs in wrapper mode without background server.';
    } else if (activeProxyId === 'pxpipe') {
      descBanner.textContent = 'PxPipe: Multimodal context proxy that converts verbose logs into compressed PNG blocks.';
    } else if (activeProxyId === 'llmlingua') {
      descBanner.textContent = 'LLMLingua: Microsoft LLMLingua-2 perplexity-based prompt & KV-cache compressor (up to 20x token reduction).';
    } else if (activeProxyId === 'tokenshift') {
      descBanner.textContent = 'TokenShift: Endpoint-level token optimization & governance for Claude Code, Cursor, Copilot, and Codex.';
    } else if (activeProxyId === 'caveman') {
      descBanner.textContent = 'Caveman: Output compression skill forcing concise, high-signal responses across 30+ coding agents. Runs in wrapper mode.';
    } else if (activeProxyId === 'leanctx') {
      descBanner.textContent = 'LeanCTX: Context intelligence layer & shell-hook MCP context compressor for AI workflows.';
    } else {
      descBanner.textContent = 'Token Cost Optimizer Proxy.';
    }
  }

  const headroomRow = document.getElementById('headroom-options-row');
  if (headroomRow) {
    headroomRow.style.display = activeProxyId === 'headroom' ? 'grid' : 'none';
  }

  el<HTMLSelectElement>('fld-mode').value = profile.mode;
  el<HTMLInputElement>('tgl-memory').checked = profile.memory;
  el<HTMLInputElement>('tgl-learn').checked = profile.learn;
  el<HTMLInputElement>('tgl-lossless').checked = profile.lossless;
  el<HTMLInputElement>('tgl-noopt').checked = profile.noOptimize;
  el<HTMLInputElement>('fld-extra-proxy').value = profile.extraProxyArgs;
  el<HTMLInputElement>('fld-extra-agent').value = profile.extraAgentArgs;
  renderEnvEditor(profile);

  // instructions card
  const instrCard = el('instructions-card');
  if (agent.launchStrategy === 'instructions') {
    instrCard.classList.remove('hidden');
    el('instructions-text').textContent = instructionsFor(agent, profile.port, activeProxyName);
  } else {
    instrCard.classList.add('hidden');
  }

  updateLaunchBar();
  if (activeTab === 'dashboard') renderDashboard();
}

let activeTab: 'agents' | 'compressors' | 'workflow' | 'settings' | 'dashboard' = 'agents';

function switchTab(tab: 'agents' | 'compressors' | 'workflow' | 'settings' | 'dashboard'): void {
  activeTab = tab;
  const tabs = ['tab-btn-agents', 'tab-btn-compressors', 'tab-btn-workflow', 'tab-btn-settings', 'tab-btn-dashboard'];
  for (const id of tabs) {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  }
  const activeMap: Record<string, string> = {
    agents: 'tab-btn-agents',
    compressors: 'tab-btn-compressors',
    workflow: 'tab-btn-workflow',
    settings: 'tab-btn-settings',
    dashboard: 'tab-btn-dashboard',
  };
  const activeBtn = document.getElementById(activeMap[tab]);
  if (activeBtn) activeBtn.classList.add('active');

  const views = ['sidebar', 'detail', 'compressors-view', 'workflow-view', 'settings-view', 'dashboard-view'];
  for (const id of views) {
    const v = document.getElementById(id);
    if (v) v.classList.add('hidden');
  }

  if (tab === 'agents') {
    el('sidebar').classList.remove('hidden');
    el('detail').classList.remove('hidden');
  } else if (tab === 'compressors') {
    el('compressors-view').classList.remove('hidden');
    renderCompressors();
  } else if (tab === 'workflow') {
    el('workflow-view').classList.remove('hidden');
    renderWorkflow();
  } else if (tab === 'settings') {
    el('settings-view').classList.remove('hidden');
    renderSettings();
  } else if (tab === 'dashboard') {
    el('dashboard-view').classList.remove('hidden');
    renderDashboard();
  }
}


/** Render the Token Compressors view - list all compressors with detection & compatibility. */
async function renderCompressors(filter = ''): Promise<void> {
  const list = el('compressor-list');
  list.innerHTML = '';
  const allProxies = await api.listProxies();
  const customProxies = config?.customProxies ?? [];
  const all = [...allProxies, ...customProxies.map((c) => ({
    id: c.id, name: c.name, description: 'User-defined compressor',
    mode: 'server' as const, envStyle: c.envStyle, accent: '#94a3b8',
    installInstructions: 'User-managed. Configure in settings.',
    executables: [c.binary], wellKnownPaths: {}, detectCommand: '',
    defaultPort: c.port, defaultFlags: {}, buildStartArgs: () => [],
    homepage: '',
  }))];

  const query = filter.trim().toLowerCase();
  const matches = (proxy: any) => !query || proxy.name.toLowerCase().includes(query) || proxy.id.includes(query);

  // Show all compressors in a flat list (detection done per-compressor when selected)
  for (const proxy of all) {
    if (!matches(proxy)) continue;
    const isCustom = customProxies.some((c) => c.id === proxy.id);
    const item = createCompressorItem(proxy, isCustom);
    list.appendChild(item);
  }

  // Wire up filter
  const filterInput = document.getElementById('compressor-filter') as HTMLInputElement | null;
  if (filterInput) {
    filterInput.oninput = (e) => renderCompressors((e.target as HTMLInputElement).value);
  }
  
  // Wire up add custom button
  const addBtn = document.getElementById('btn-add-custom-proxy');
  if (addBtn) {
    addBtn.onclick = () => { showCustomProxyForm(); };
  }
}

function createCompressorItem(proxy: any, isCustom: boolean): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'agent-item' + (selectedCompressor === proxy.id ? ' selected' : '');
  item.dataset.compressorId = proxy.id;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = 'linear-gradient(135deg, ' + (proxy as any).accent + ', ' + (proxy as any).accent + '99)';
  avatar.textContent = proxy.name.charAt(0);
  const text = document.createElement('div');
  text.className = 'agent-item-text';
  text.innerHTML = '<div class="agent-item-name">' + proxy.name + (isCustom ? ' <span class="badge">Custom</span>' : '') + '</div><div class="agent-item-sub">' + ((proxy as any).mode || 'server') + ' / ' + (((proxy as any).installInstructions || '')).slice(0, 50) + '</div>';
  item.append(avatar, text);
  item.onclick = () => selectCompressor(proxy.id);
  return item;
}

let selectedCompressor: string | null = null;

/** Normalize any compressor (built-in ProxyDefinition or CustomProxy) to a stable display shape. */
function normalizeCompressor(proxy: any): any {
  if (!proxy) return proxy;
  return {
    ...proxy,
    mode: proxy.mode ?? 'server',
    accent: proxy.accent ?? '#94a3b8',
    description: proxy.description || 'User-defined compressor',
    installInstructions: proxy.installInstructions || 'User-managed. Configure in Settings or install via CLI.',
    binary: proxy.binary ?? '',
  };
}

function selectCompressor(id: string): void {
  selectedCompressor = id;
  renderCompressors();
  const raw = [...PROXIES, ...(config?.customProxies ?? [])].find((p) => p.id === id);
  if (!raw) return;
  const proxy = normalizeCompressor(raw);
  el('compressor-detail-empty').classList.add('hidden');
  el('compressor-detail-content').classList.remove('hidden');
  const infoCard = el('compressor-info-card');
  infoCard.innerHTML = '<div class="agent-header"><div class="avatar" style="background:linear-gradient(135deg,' + proxy.accent + ',' + proxy.accent + '99);">' + proxy.name.charAt(0) + '</div><div class="agent-header-text"><div class="agent-title-row"><h2>' + proxy.name + '</h2><span class="badge">' + proxy.mode + '</span></div><p class="muted">' + proxy.description + '</p></div></div>';
  el('compressor-install-cmd').textContent = proxy.installInstructions;
  el('compressor-detect-status').textContent = '';
  const pathInput = document.getElementById('compressor-binary-path') as HTMLInputElement | null;
  // Prefill the saved path (headroom settings, proxy profile, or custom entry).
  const savedPath =
    proxy.id === 'headroom'
      ? (config?.headroomPath ?? '')
      : (config?.proxies.find((p) => p.proxyId === proxy.id)?.profiles[0]?.proxyPath ?? '') ||
        (proxy.binary ?? '');
  if (pathInput) pathInput.value = savedPath;

  // Populate multi-option install selector (hidden when only one / none).
  const optionSelect = document.getElementById('compressor-install-option') as HTMLSelectElement | null;
  const optionNote = document.getElementById('compressor-install-option-note');
  const optionField = document.getElementById('compressor-install-options-field');
  void (async () => {
    try {
      const options = await api.installProxyOptions(proxy.id);
      if (!optionSelect || !optionField) return;
      optionSelect.innerHTML = '';
      if (!options || options.length === 0) {
        optionField.classList.add('hidden');
        return;
      }
      optionField.classList.remove('hidden');
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = options.length > 1 ? `${opt.label} — ${opt.command}` : opt.label;
        optionSelect.appendChild(o);
      }
      const syncNote = () => {
        const selected = options.find((o) => o.id === optionSelect.value);
        if (optionNote) optionNote.textContent = selected?.note || selected?.command || '';
        el('compressor-install-cmd').textContent = selected?.command || proxy.installInstructions;
      };
      optionSelect.onchange = syncNote;
      syncNote();
      // Single option: still show the command, but keep the selector compact.
      if (options.length === 1) {
        optionSelect.disabled = true;
      } else {
        optionSelect.disabled = false;
      }
    } catch {
      optionField?.classList.add('hidden');
    }
  })();

  el('btn-detect-compressor').onclick = async () => {
    el('compressor-detect-status').textContent = 'Detecting...';
    const result = await api.detectProxy(proxy.id);
    if (result.found) {
      el('compressor-detect-status').innerHTML = '<span style="color:var(--ok)">Found at ' + result.paths[0] + '</span>';
      if (pathInput) pathInput.value = result.paths[0];
    } else {
      el('compressor-detect-status').innerHTML = '<span style="color:var(--warn)">Not found on PATH</span>';
    }
  };
  el('btn-install-compressor').onclick = async () => {
    const btn = document.getElementById('btn-install-compressor') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Installing...';
    const optionId = (document.getElementById('compressor-install-option') as HTMLSelectElement | null)?.value;
    const res = await api.installProxy(proxy.id, optionId || undefined);
    toast(res.message, res.ok ? 'ok' : 'err');
    let foundPath = res.paths?.[0];
    if (!foundPath && res.ok) {
      const detected = await api.detectProxy(proxy.id);
      if (detected.found) foundPath = detected.paths[0];
    }
    if (foundPath && pathInput) {
      pathInput.value = foundPath;
      el('compressor-detect-status').innerHTML = '<span style="color:var(--ok)">Found at ' + foundPath + '</span>';
      // Auto-persist so launch uses the detected binary immediately.
      try {
        if (proxy.id === 'headroom') {
          config!.headroomPath = foundPath;
        } else {
          const slot = config!.proxies.find((p) => p.proxyId === proxy.id) ?? {
            proxyId: proxy.id,
            profiles: [{ name: 'Default', proxyPath: '', port: (proxy as any).defaultPort ?? 8989, flags: {}, envOverrides: {} }],
            activeProfile: 'Default',
          };
          if (!config!.proxies.includes(slot as any)) config!.proxies.push(slot as any);
          (slot as any).profiles[0].proxyPath = foundPath;
        }
        await saveConfig(true);
      } catch { /* non-fatal */ }
    } else if (res.ok) {
      el('compressor-detect-status').innerHTML = '<span style="color:var(--warn)">Installed but not detected — click Detect or set path</span>';
    }
    btn.disabled = false;
    btn.textContent = 'Install via CLI';
  };
  el('btn-save-compressor').onclick = async () => {
    const binary = (document.getElementById('compressor-binary-path') as HTMLInputElement)?.value?.trim() ?? '';
    const status = el('compressor-save-status');
    try {
      if (proxy.id === 'headroom') {
        config!.headroomPath = binary;
      } else {
        // Persist into the proxy profile or the custom entry.
        const slot = config!.proxies.find((p) => p.proxyId === proxy.id) ?? { proxyId: proxy.id, profiles: [{ name: 'Default', proxyPath: '', port: (proxy as any).defaultPort ?? 8989, flags: {}, envOverrides: {} }], activeProfile: 'Default' };
        if (!config!.proxies.includes(slot as any)) config!.proxies.push(slot as any);
        (slot as any).profiles[0].proxyPath = binary;
      }
      await saveConfig(true);
      status.textContent = 'Saved binary path for ' + proxy.name;
      status.style.color = 'var(--ok)';
      toast('Compressor path saved: ' + proxy.name);
    } catch (err) {
      status.textContent = 'Save failed: ' + String(err);
      status.style.color = 'var(--err)';
    }
  };
  el('btn-set-default-compressor').onclick = async () => {
    config!.defaultCompressor = proxy.id;
    await saveConfig(true);
    toast('Default compressor set to ' + proxy.name);
  };
}

// @ts-ignore (kept for future use)
async function showCustomProxyForm(edit?: { id?: string; name?: string; binary?: string; startCommand?: string; port?: number }): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><h2>' + (edit ? 'Edit' : 'Add') + ' custom compressor</h2><div class="field"><label>Name</label><input id="cp-name" type="text" value="' + (edit?.name ?? '') + '" placeholder="My Compressor" /></div><div class="field"><label>Binary path</label><input id="cp-binary" type="text" value="' + (edit?.binary ?? '') + '" placeholder="/usr/local/bin/my-compressor" /></div><div class="field"><label>Start command template</label><input id="cp-command" type="text" value="' + (edit?.startCommand ?? '--port {port}') + '" placeholder="--port {port}" /></div><div class="field"><label>Port</label><input id="cp-port" type="number" value="' + (edit?.port ?? 8199) + '" min="1" max="65535" /></div><div class="field"><label>Env style</label><select id="cp-env"><option value="both">Both (ANTHROPIC_BASE_URL + OPENAI_BASE_URL)</option><option value="anthropic">Anthropic only</option><option value="openai">Openai only</option><option value="none">None</option></select></div><div class="modal-actions"><button class="btn btn-ghost btn-cancel">Cancel</button><button class="btn btn-primary btn-save-cp">Save</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.btn-save-cp')?.addEventListener('click', async () => {
    const name = (document.getElementById('cp-name') as HTMLInputElement)?.value?.trim();
    const binary = (document.getElementById('cp-binary') as HTMLInputElement)?.value?.trim();
    const startCommand = (document.getElementById('cp-command') as HTMLInputElement)?.value?.trim();
    const port = Number((document.getElementById('cp-port') as HTMLInputElement)?.value) || 8199;
    const envStyle = (document.getElementById('cp-env') as HTMLSelectElement)?.value ?? 'both';
    if (!name) { toast('Name is required', 'err'); return; }
    if (!binary) { toast('Binary path is required', 'err'); return; }
    const result = await api.saveCustomProxy({ id: edit?.id ?? '', name, binary, startCommand, port, envStyle: envStyle as any, baseUrlTemplate: 'http://127.0.0.1:{port}', timeoutMs: 30000 });
    if (result.ok) {
      config!.customProxies = config?.customProxies ?? [];
      if (edit && result.proxy) {
        const idx = config!.customProxies.findIndex((c) => c.id === edit.id);
        if (idx >= 0) config!.customProxies[idx] = result.proxy;
      } else if (result.proxy) {
        config!.customProxies.push(result.proxy);
      }
      await saveConfig(true);
      overlay.remove();
      toast('Custom compressor saved');
      renderCompressors();
    } else {
      toast(result.error ?? 'Save failed', 'err');
    }
  });
}

/** Render the Settings view inline. */
function renderSettings(): void {
  if (!config) return;
  const container = el('settings-content');
  container.innerHTML = '';
  const compSection = document.createElement('div');
  compSection.className = 'card settings-section';
  compSection.innerHTML = '<h3>Default compressor</h3>';
  const compSelect = document.createElement('select');
  for (const p of PROXIES) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + ' - ' + p.description;
    opt.selected = (config.defaultCompressor || 'headroom') === p.id;
    compSelect.appendChild(opt);
  }
  for (const cp of (config.customProxies ?? [])) {
    const opt = document.createElement('option');
    opt.value = cp.id;
    opt.textContent = cp.name + ' (custom)';
    opt.selected = config.defaultCompressor === cp.id;
    compSelect.appendChild(opt);
  }
  compSelect.onchange = () => { config!.defaultCompressor = compSelect.value; saveConfig(true); };
  compSection.appendChild(compSelect);
  container.appendChild(compSection);
  const pathSection = document.createElement('div');
  pathSection.className = 'card settings-section';
  pathSection.innerHTML = '<h3>Headroom binary path</h3>';
  const pathRow = document.createElement('div');
  pathRow.className = 'field-row';
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.placeholder = 'Empty = auto-detect';
  pathInput.value = config.headroomPath;
  pathInput.onchange = () => { config!.headroomPath = pathInput.value.trim(); saveConfig(true); };
  pathRow.appendChild(pathInput);
  pathSection.appendChild(pathRow);
  container.appendChild(pathSection);
  const timeoutSection = document.createElement('div');
  timeoutSection.className = 'card settings-section';
  timeoutSection.innerHTML = '<h3>Proxy startup timeout (seconds)</h3>';
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.min = '5';
  timeoutInput.max = '300';
  timeoutInput.value = String(Math.round(config.proxyStartupTimeoutMs / 1000));
  timeoutInput.onchange = () => {
    const seconds = Number(timeoutInput.value);
    if (Number.isFinite(seconds) && seconds >= 5 && seconds <= 300) { config!.proxyStartupTimeoutMs = Math.round(seconds * 1000); saveConfig(true); }
  };
  timeoutSection.appendChild(timeoutInput);
  container.appendChild(timeoutSection);
  const themeSection = document.createElement('div');
  themeSection.className = 'card settings-section';
  themeSection.innerHTML = '<h3>Theme</h3>';
  const themeSelect = document.createElement('select');
  for (const [value, label] of [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']] as const) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label; opt.selected = config.theme === value;
    themeSelect.appendChild(opt);
  }
  themeSelect.onchange = () => { config!.theme = themeSelect.value as ThemeMode; applyTheme(config!.theme); saveConfig(true); };
  themeSection.appendChild(themeSelect);
  container.appendChild(themeSection);
  const cwdSection = document.createElement('div');
  cwdSection.className = 'card settings-section';
  cwdSection.innerHTML = '<h3>Default working directory</h3>';
  const cwdInput = document.createElement('input');
  cwdInput.type = 'text';
  cwdInput.placeholder = 'Empty = current directory';
  cwdInput.value = config.defaultWorkingDirectory ?? '';
  cwdInput.onchange = () => { config!.defaultWorkingDirectory = cwdInput.value.trim(); saveConfig(true); };
  cwdSection.appendChild(cwdInput);
  container.appendChild(cwdSection);
  const termSection = document.createElement('div');
  termSection.className = 'card settings-section';
  termSection.innerHTML = '<h3>Terminal fallback</h3>';
  const termLabel = document.createElement('label');
  termLabel.className = 'toggle';
  const termCheck = document.createElement('input');
  termCheck.type = 'checkbox';
  termCheck.checked = config.terminalFallback ?? false;
  termCheck.onchange = () => { config!.terminalFallback = termCheck.checked; saveConfig(true); };
  termLabel.append(termCheck, document.createTextNode(' Fall back to external terminal window'));
  termSection.appendChild(termLabel);
  container.appendChild(termSection);
  renderCustomAgentsSection(container);
}

function renderCustomAgentsSection(container: HTMLElement): void {
  const customSection = document.createElement('div');
  customSection.className = 'card settings-section';
  customSection.innerHTML = '<h3>Custom agents <span class="muted small">(' + (config?.customAgents?.length ?? 0) + ')</span></h3>';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary small-btn';
  addBtn.textContent = '+ Add custom agent';
  addBtn.onclick = () => { showCustomAgentForm(undefined, () => { renderSettings(); }); };
  customSection.appendChild(addBtn);
  const list = document.createElement('div');
  list.className = 'custom-entries-list';
  for (const ca of config?.customAgents ?? []) {
    const row = document.createElement('div');
    row.className = 'custom-entry-row';
    row.innerHTML = '<span><strong>' + ca.name + '</strong> <span class="muted small">(port ' + ca.port + ')</span></span><div><button class="btn btn-ghost small-btn btn-edit-ca" data-id="' + ca.id + '">Edit</button><button class="btn btn-danger-ghost small-btn btn-delete-ca" data-id="' + ca.id + '">Delete</button></div>';
    list.appendChild(row);
  }
  customSection.appendChild(list);
  container.appendChild(customSection);
  list.querySelectorAll('.btn-delete-ca').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      await api.deleteCustomAgent(id);
      config!.customAgents = config!.customAgents.filter((c) => c.id !== id);
      await saveConfig(true);
      toast('Custom agent deleted');
      renderSettings();
    });
  });
  list.querySelectorAll('.btn-edit-ca').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id || '';
      const ca = config?.customAgents.find((c) => c.id === id);
      if (ca) showCustomAgentForm(ca, () => renderSettings());
    });
  });
}

async function showCustomAgentForm(edit: any, onSaved?: () => void): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><h2>' + (edit ? 'Edit' : 'Add') + ' custom agent</h2><div class="field"><label>Name</label><input id="ca-name" type="text" value="' + (edit?.name ?? '') + '" placeholder="My Agent" /></div><div class="field"><label>Binary (or command)</label><input id="ca-binary" type="text" value="' + (edit?.binary ?? '') + '" placeholder="/usr/local/bin/my-agent" /></div><div class="field"><label>Extra args</label><input id="ca-args" type="text" value="' + (edit?.args ?? '') + '" placeholder="--flag --option value" /></div><div class="field"><label>Port</label><input id="ca-port" type="number" value="' + (edit?.port ?? 8820) + '" min="1" max="65535" /></div><div class="field"><label>Env style</label><select id="ca-env"><option value="both" ' + (edit?.envStyle === 'both' ? 'selected' : '') + '>Both</option><option value="anthropic" ' + (edit?.envStyle === 'anthropic' ? 'selected' : '') + '>Anthropic</option><option value="openai" ' + (edit?.envStyle === 'openai' ? 'selected' : '') + '>OpenAI</option><option value="none" ' + (edit?.envStyle === 'none' ? 'selected' : '') + '>None</option></select></div><div class="modal-actions"><button class="btn btn-ghost btn-cancel-ca">Cancel</button><button class="btn btn-primary btn-save-ca">Save</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-cancel-ca')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.btn-save-ca')?.addEventListener('click', async () => {
    const name = (document.getElementById('ca-name') as HTMLInputElement)?.value?.trim();
    const binary = (document.getElementById('ca-binary') as HTMLInputElement)?.value?.trim();
    const args = (document.getElementById('ca-args') as HTMLInputElement)?.value?.trim();
    const port = Number((document.getElementById('ca-port') as HTMLInputElement)?.value) || 8820;
    const envStyle = (document.getElementById('ca-env') as HTMLSelectElement)?.value ?? 'both';
    if (!name) { toast('Name is required', 'err'); return; }
    const result = await api.saveCustomAgent({ id: edit?.id ?? '', name, binary, command: binary, args, port, envStyle: envStyle as any, envOverrides: edit?.envOverrides ?? {}, workingDirectory: '' });
    if (result.ok) {
      config!.customAgents = config?.customAgents ?? [];
      if (edit && result.agent) {
        const idx = config!.customAgents.findIndex((c) => c.id === edit.id);
        if (idx >= 0) config!.customAgents[idx] = result.agent;
      } else if (result.agent) {
        config!.customAgents.push(result.agent);
      }
      await saveConfig(true);
      overlay.remove();
      toast('Custom agent saved');
      onSaved?.();
    } else {
      toast(result.error ?? 'Save failed', 'err');
    }
  });
}

/* =============================== Workflow ============================== */

interface WorkflowSession {
  id: string;
  agentId: string;
  agentName: string;
  compressorId: string;
  launchId: string;
  trackerId?: string;
  state: string;
  output: string[];
}

const workflowSessions: WorkflowSession[] = [];
let activeWorkflowSession: string | null = null;

/** A session is "live" (accepts input) only while the agent process is up. */
function isSessionLive(state: string): boolean {
  return state === 'running' || state === 'starting' || state === 'proxy-up';
}

function renderWorkflow(): void {
  renderWorkflowTabs();
  if (activeWorkflowSession) {
    const session = workflowSessions.find((s) => s.id === activeWorkflowSession);
    if (session) showWorkflowTerminal(session);
    else showWorkflowEmpty();
  } else {
    showWorkflowEmpty();
  }
}

function renderWorkflowTabs(): void {
  const container = el('workflow-tabs');
  container.innerHTML = '';
  for (const session of workflowSessions) {
    const tab = document.createElement('div');
    tab.className = 'workflow-tab-item' + (session.id === activeWorkflowSession ? ' active' : '');
    tab.innerHTML = '<span class="wf-tab-icon">\u{1F916}</span><span class="wf-tab-name">' + escapeHtml(session.agentName) + '</span><span class="wf-tab-state ' + session.state + '"></span>';
    tab.onclick = () => { activeWorkflowSession = session.id; renderWorkflow(); };
    // Right-click context menu
    tab.oncontextmenu = (e) => {
      e.preventDefault();
      showWorkflowContextMenu(e.clientX, e.clientY, session);
    };
    container.appendChild(tab);
  }
  el('wf-btn-new-session').onclick = () => {
    switchTab('agents');
    toast('Select an agent from the Agents tab to launch');
  };
}

/** Show a right-click context menu for a workflow session. */
function showWorkflowContextMenu(x: number, y: number, session: WorkflowSession): void {
  // Remove any existing context menu
  document.querySelector('.workflow-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'workflow-context-menu';
  menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:300;';

  const items = [
    { label: 'Rename', icon: '\u270F\uFE0F', action: () => {
      const name = prompt('Rename session:', session.agentName);
      if (name && name.trim()) { session.agentName = name.trim(); renderWorkflowTabs(); showWorkflowTerminal(session); }
    }},
    { label: session.state === 'running' || session.state === 'proxy-up' ? 'Pause' : 'Resume', icon: session.state === 'running' ? '\u23F8\uFE0F' : '\u25B6\uFE0F', action: () => {
      if (session.state === 'running' || session.state === 'proxy-up') {
        session.state = 'stopped';
        workflowStatusLine(session, '[Paused]');
        renderWorkflowTabs();
        if (activeWorkflowSession === session.id) showWorkflowTerminal(session);
      } else {
        session.state = 'running';
        workflowStatusLine(session, '[Resumed]');
        renderWorkflowTabs();
        if (activeWorkflowSession === session.id) showWorkflowTerminal(session);
      }
    }},
    { label: 'Restart', icon: '\uD83D\uDD04', action: async () => {
      try { await api.stop(session.launchId); } catch {}
      session.output = [];
      workflowXtermLaunchId = null;
      workflowStatusLine(session, 'Restarting...');
      renderWorkflowTabs();
      if (activeWorkflowSession === session.id) showWorkflowTerminal(session);
      try {
        const rt = await api.launchEmbedded({ agentId: session.agentId, compressorId: session.compressorId });
        session.launchId = rt.id ?? session.launchId;
        session.trackerId = (rt as any).trackerId;
        session.state = rt.state;
        if (rt.output?.length) session.output = [...rt.output];
        workflowStatusLine(session, 'Restarted on port ' + rt.port);
      } catch (err) {
        workflowStatusLine(session, 'Error: ' + String(err));
      }
      renderWorkflow();
    }},
    { label: 'Stop', icon: '\u23F9\uFE0F', action: async () => {
      try { await api.stop(session.launchId); } catch {}
      session.state = 'stopped';
      workflowStatusLine(session, '[Stopped]');
      renderWorkflowTabs();
      if (activeWorkflowSession === session.id) showWorkflowTerminal(session);
      toast('Stopped: ' + session.agentName);
    }},
    { label: 'Close', icon: '\u2716\uFE0F', action: async () => {
      try { await api.stop(session.launchId); } catch {}
      const idx = workflowSessions.indexOf(session);
      if (idx >= 0) workflowSessions.splice(idx, 1);
      runtimes.delete(session.agentId);
      if (activeWorkflowSession === session.id) {
        activeWorkflowSession = workflowSessions.length > 0 ? workflowSessions[workflowSessions.length - 1].id : null;
      }
      renderWorkflow();
      toast('Closed: ' + session.agentName);
    }},
  ];

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-item';
    btn.innerHTML = '<span class="ctx-icon">' + item.icon + '</span> ' + item.label;
    btn.onclick = () => { item.action(); menu.remove(); };
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  // Close menu on click outside
  setTimeout(() => {
    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 0);
}

function showWorkflowEmpty(): void {
  el('workflow-empty').classList.remove('hidden');
  el('workflow-terminal').classList.add('hidden');
}

/** Shared xterm instance for the Workflow pane (one visible session at a time). */
let workflowXterm: Terminal | null = null;
let workflowFit: FitAddon | null = null;
let workflowXtermLaunchId: string | null = null;
let workflowDataUnsub: (() => void) | null = null;

function ensureWorkflowXterm(): Terminal {
  const host = document.getElementById('workflow-xterm');
  if (!host) throw new Error('workflow-xterm host missing');
  if (workflowXterm) return workflowXterm;

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    theme: {
      background: '#0a0e14',
      foreground: '#e0e6f0',
      cursor: '#22d3ee',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  workflowXterm = term;
  workflowFit = fit;

  // Keystrokes go straight to the agent PTY — no second "$" input row.
  term.onData((data) => {
    const sess = workflowSessions.find((s) => s.id === activeWorkflowSession);
    if (!sess?.launchId || !isSessionLive(sess.state)) return;
    void api.writeStdin(sess.launchId, data, true);
  });

  window.addEventListener('resize', () => {
    try { workflowFit?.fit(); } catch { /* ignore */ }
  });

  if (!workflowDataUnsub) {
    workflowDataUnsub = api.onTerminalData(({ launchId, data }) => {
      const sess = workflowSessions.find((s) => s.id === activeWorkflowSession);
      if (!sess || sess.launchId !== launchId) return;
      if (!workflowXterm) return;
      workflowXterm.write(data);
      try { workflowXterm.focus(); } catch { /* ignore */ }
    });
  }

  return term;
}

function showWorkflowTerminal(session: WorkflowSession): void {
  el('workflow-empty').classList.add('hidden');
  el('workflow-terminal').classList.remove('hidden');
  el('wf-session-title').textContent =
    session.agentName + ' · ' + session.compressorId + (session.state === 'running' ? '' : ' · ' + session.state);

  const term = ensureWorkflowXterm();
  // Switching sessions: clear and show a short banner; live PTY stream continues for active launch.
  if (workflowXtermLaunchId !== session.launchId) {
    term.reset();
    workflowXtermLaunchId = session.launchId;
    if (session.output.length > 0) {
      // Seed with any hydrated spawn lines (stripped) then live ANSI takes over.
      for (const line of session.output) {
        term.writeln(stripAnsi(line));
      }
    }
  }
  try { workflowFit?.fit(); } catch { /* ignore */ }
  setTimeout(() => term.focus(), 50);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Strip ANSI escape codes from terminal output. Covers CSI, OSC, DCS, SOS, PM, APC. */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')       // CSI sequences: ESC[<params><letter>
    .replace(/\x1B\][0-9;]*(\x07|\x1B\\)/g, '')  // OSC sequences: ESC]<params>(BEL|ST)
    .replace(/\x1B[PX^_].*?(\x07|\x1B\\)/g, '')  // DCS/SOS/PM/APC sequences
    .replace(/\x1B[[\]()][0-9;]*[~0-9]/g, '')      // DEC private sequences
    .replace(/\x1B[<=>]/g, '')                      // DEC private prefix
    .replace(/\x1B[NO]/g, '')                       // SS2/SS3 single shifts
    .replace(/\x1BM/g, '')                          // RI reverse index
    .replace(/\x1B7/g, '')                          // DECSC save cursor
    .replace(/\x1B8/g, '')                          // DECRC restore cursor
    .replace(/\x1BD/g, '')                          // IND index
    .replace(/\x1BE/g, '')                          // NEL next line
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters (keep TAB, LF, CR)
    .replace('\x1B', '');                            // Lone ESC
}

/** Write a status line into the live xterm (and session buffer) if visible. */
function workflowStatusLine(session: WorkflowSession, text: string): void {
  session.output.push(text);
  if (activeWorkflowSession === session.id && workflowXterm) {
    workflowXterm.writeln(text);
  }
}

/** Add a new workflow session from an embedded launch. */
async function addWorkflowSession(agentId: string, compressorId?: string): Promise<void> {
  // Check if this agent+compressor combo is already running
  const resolvedCompressorId = compressorId || config?.defaultCompressor || 'headroom';
  const existing = workflowSessions.find(
    (s) => s.agentId === agentId && s.compressorId === resolvedCompressorId
  );
  if (existing) {
    if (existing.state === 'running' || existing.state === 'proxy-up') {
      toast('Session already running for ' + existing.agentName, 'err');
      activeWorkflowSession = existing.id;
      switchTab('workflow');
      renderWorkflow();
      return;
    }
    // Session exists but is stopped - remove it and create new
    const idx = workflowSessions.indexOf(existing);
    if (idx >= 0) workflowSessions.splice(idx, 1);
  }

  try {
    const rt = await api.launchEmbedded({ agentId, compressorId });
    const launchId = rt.id ?? (agentId + '-' + Date.now());
    const agent = agents.find((a) => a.id === agentId);
    const placeholder = ['Session started on port ' + (rt.port ?? 'unknown')];
    const trackerOutput = rt.output ?? [];
    const session: WorkflowSession = {
      id: launchId,
      agentId,
      agentName: agent?.name ?? agentId,
      compressorId: compressorId || config?.defaultCompressor || 'headroom',
      launchId,
      trackerId: rt.trackerId,
      state: rt.state,
      // Prefer spawn/PTY lines collected during launch over a bare placeholder.
      output: trackerOutput.length > 0 ? trackerOutput : placeholder,
    };
    workflowSessions.push(session);
    activeWorkflowSession = session.id;
    switchTab('workflow');
    renderWorkflow();
    toast('Session started: ' + session.agentName);
  } catch (err) {
    toast('Failed to launch: ' + String(err), 'err');
  }
}

/** Listen for output events and route to the correct workflow session. */
function setupWorkflowOutputListener(): void {
  api.onOutput((record) => {
    // onRuntimeChange used to send undefined when alloc id ≠ tracker id.
    if (!record || !record.id) return;
    const session = workflowSessions.find((s) => s.trackerId === record.id || s.launchId === record.id);
    if (session) {
      session.state = record.state;
      if (record.output && record.output.length >= session.output.length && record.output.length > 0) {
        session.output = record.output;
      }
      renderWorkflowTabs();
      if (activeWorkflowSession === session.id) {
        el('wf-session-title').textContent =
          session.agentName + ' · ' + session.compressorId + (session.state === 'running' ? '' : ' · ' + session.state);
      }
    }
  });
}


function renderDashboard(): void {
  if (!config) return;
  const activeProxyId = config.defaultCompressor || 'headroom';
  const proxyDef = PROXIES.find((p) => p.id === activeProxyId) || {
    id: activeProxyId,
    name: activeProxyId.toUpperCase(),
    defaultPort: 8989,
    mode: 'server' as const,
  };

  const agent = selectedId ? agents.find((a) => a.id === selectedId) : undefined;
  const profile = selectedId ? currentProfile() : undefined;
  const port = profile?.port ?? proxyDef.defaultPort ?? 8989;
  const runningState = selectedId ? runtimes.get(selectedId) : undefined;
  const isUp = runningState?.state === 'running' || runningState?.state === 'proxy-up' || runningState?.state === 'starting';

  const proxyNameEl = el('dash-proxy-name');
  if (proxyNameEl) proxyNameEl.textContent = `${proxyDef.name} Live Telemetry Dashboard`;

  const metricProxy = el('dash-metric-proxy');
  if (metricProxy) metricProxy.textContent = proxyDef.name;

  const metricMode = el('dash-metric-mode');
  if (metricMode) metricMode.textContent = `${profile?.mode ?? 'cache'} mode`;

  const metricPort = el('dash-metric-port');
  if (metricPort) metricPort.textContent = `127.0.0.1:${port}`;

  const metricAgent = el('dash-metric-agent');
  if (metricAgent) metricAgent.textContent = agent?.name ?? 'None';

  const metricPid = el('dash-metric-pid');
  if (metricPid) metricPid.textContent = runningState?.proxyPid ? `PID ${runningState.proxyPid}` : 'Process Standby';

  const statusText = el('dash-status-text');
  const statusPill = el('dash-status-pill');
  if (statusText && statusPill) {
    statusText.textContent = isUp ? `${proxyDef.name} Active` : `${proxyDef.name} Standby`;
    statusPill.className = `pill ${isUp ? 'pill-ok' : 'pill-unknown'}`;
  }

  const iframe = el<HTMLIFrameElement>('dash-iframe');
  const fallback = el('dash-no-ui-fallback');
  const fallbackMsg = el('dash-fallback-msg');

  const targetUrl = `http://127.0.0.1:${port}/dashboard`;

  if (iframe && fallback) {
    if (proxyDef.mode === 'server') {
      iframe.classList.remove('hidden');
      fallback.classList.add('hidden');
      if (iframe.src !== targetUrl) {
        iframe.src = targetUrl;
      }
    } else {
      iframe.classList.add('hidden');
      fallback.classList.remove('hidden');
      if (fallbackMsg) {
        fallbackMsg.textContent = `${proxyDef.name} runs in wrapper mode. Terminal command outputs are compressed directly in shell streams.`;
      }
    }
  }
}

function instructionsFor(agent: AgentDefinition, port: number, proxyName = 'Token Optimizer'): string {
  if (agent.id === 'continue') {
    return [
      `1. Keep this proxy running (Launch above).`,
      `2. Edit ~/.continue/config.json (or config.yaml) and add an OpenAI-compatible model:`,
      ``,
      `   { "models": [{`,
      `       "title": "${proxyName}",`,
      `       "provider": "openai",`,
      `       "model": "default",`,
      `       "apiBase": "http://127.0.0.1:${port}/v1"`,
      `   }] }`,
      ``,
      `3. Select the "${proxyName}" model in Continue.`,
    ].join('\n');
  }
  return `Point ${agent.name} at the local proxy:\n  ANTHROPIC_BASE_URL=http://127.0.0.1:${port}\n  OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`;
}

function renderProfileBar(): void {
  const ac = agentConfig(selectedId!);
  const select = el<HTMLSelectElement>('profile-select');
  select.innerHTML = '';
  for (const p of ac.profiles) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    opt.selected = p.name === ac.activeProfile;
    select.appendChild(opt);
  }
  el('btn-profile-delete').toggleAttribute('disabled', ac.profiles.length <= 1);
  el('profile-hint').textContent = `${ac.profiles.length} saved profile${ac.profiles.length > 1 ? 's' : ''}`;
}

function renderDetectedPaths(agent: AgentDefinition, scan?: ScanResult): void {
  const box = el('detected-paths');
  box.innerHTML = '';
  if (!scan || !scan.found) return;
  for (const p of scan.paths) {
    const chip = document.createElement('button');
    chip.className = 'detected-path';
    chip.textContent = p;
    chip.title = 'Click to use this path explicitly';
    chip.onclick = () => {
      const profile = currentProfile();
      profile.agentPath = p;
      el<HTMLInputElement>('fld-path').value = p;
      toast(`Using explicit path for ${agent.name}`);
    };
    box.appendChild(chip);
  }
}

async function populateAgentInstallOptions(agentId: string): Promise<void> {
  const optionSelect = document.getElementById('agent-install-option') as HTMLSelectElement | null;
  const optionNote = document.getElementById('agent-install-option-note');
  const optionField = document.getElementById('agent-install-options-field');
  const installBtn = document.getElementById('btn-install-agent') as HTMLButtonElement | null;
  if (!optionSelect || !optionField || !installBtn) return;
  try {
    const options = await api.installAgentOptions(agentId);
    optionSelect.innerHTML = '';
    if (!options || options.length === 0) {
      optionField.classList.add('hidden');
      return;
    }
    optionField.classList.remove('hidden');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = options.length > 1 ? `${opt.label} — ${opt.command}` : `${opt.label}: ${opt.command}`;
      optionSelect.appendChild(o);
    }
    const syncNote = () => {
      const selected = options.find((x) => x.id === optionSelect.value);
      if (optionNote) optionNote.textContent = selected?.note || selected?.command || '';
    };
    optionSelect.onchange = syncNote;
    syncNote();
    optionSelect.disabled = options.length <= 1;
    installBtn.onclick = async () => {
      installBtn.disabled = true;
      installBtn.textContent = 'Installing…';
      const status = document.getElementById('agent-install-status');
      if (status) status.textContent = 'Running install… check Logs.';
      try {
        const res = await api.installAgent(agentId, optionSelect.value || undefined);
        toast(res.message, res.ok ? 'ok' : 'err');
        if (status) status.textContent = res.message;
        if (res.ok && res.paths && res.paths.length > 0) {
          currentProfile().agentPath = res.paths[0];
          el<HTMLInputElement>('fld-path').value = res.paths[0];
          await saveConfig(true);
        }
        const scan = await api.scanAgent(agentId, currentProfile().agentPath || undefined);
        scans.set(agentId, scan);
        if (scan.found && !currentProfile().agentPath) {
          currentProfile().agentPath = scan.paths[0];
          el<HTMLInputElement>('fld-path').value = scan.paths[0];
          await saveConfig(true);
        }
        renderDetail();
      } catch (err) {
        toast(String(err), 'err');
      } finally {
        installBtn.disabled = false;
        installBtn.textContent = '⚡ Install agent via CLI';
      }
    };
  } catch {
    optionField.classList.add('hidden');
  }
}

function renderEnvEditor(profile: AgentProfile): void {
  const editor = el('env-editor');
  editor.innerHTML = '';
  for (const [key, value] of Object.entries(profile.envOverrides)) {
    addEnvRow(profile, key, value);
  }
}

function addEnvRow(profile: AgentProfile, key = '', value = ''): void {
  const editor = el('env-editor');
  const row = document.createElement('div');
  row.className = 'env-row';
  const keyInput = document.createElement('input');
  keyInput.className = 'env-key';
  keyInput.placeholder = 'VARIABLE_NAME';
  keyInput.value = key;
  const valInput = document.createElement('input');
  valInput.placeholder = 'value';
  valInput.value = value;
  const remove = document.createElement('button');
  remove.className = 'btn btn-ghost small-btn';
  remove.textContent = '✕';
  let oldKey = key;
  const sync = () => {
    if (oldKey) delete profile.envOverrides[oldKey];
    const k = keyInput.value.trim();
    if (k) profile.envOverrides[k] = valInput.value;
    oldKey = k;
  };
  keyInput.oninput = sync;
  valInput.oninput = sync;
  remove.onclick = () => {
    sync();
    if (oldKey) delete profile.envOverrides[oldKey];
    row.remove();
  };
  row.append(keyInput, valInput, remove);
  editor.appendChild(row);
}

/* ============================= Launch bar ============================== */

function updateLaunchBar(): void {
  if (!selectedId) return;
  const rt = runtimeFor(selectedId);
  const busy = rt.state === 'starting' || rt.state === 'stopping';
  const active = rt.state === 'running' || rt.state === 'proxy-up';
  el('btn-launch').classList.toggle('hidden', active);
  el('btn-stop').classList.toggle('hidden', !active);
  el<HTMLButtonElement>('btn-launch').disabled = busy;
  el<HTMLButtonElement>('btn-stop').disabled = busy;
  const status = el('launch-status');
  status.textContent = rt.error ? `${STATE_LABEL[rt.state]}: ${rt.error}` : rt.state === 'stopped' ? '' : `${STATE_LABEL[rt.state]}${rt.port ? ` on port ${rt.port}` : ''}${rt.proxyPid ? ` · proxy pid ${rt.proxyPid}` : ''}`;
}

async function launch(): Promise<void> {
  if (!selectedId) return;
  syncFormToProfile();
  if (!(await saveConfig(true))) return;
  const agent = agents.find((a) => a.id === selectedId)!;
  el('launch-status').textContent = 'Starting Headroom proxy…';
  try {
    const rt = await api.start({ agentId: selectedId });
    runtimes.set(selectedId, rt);
    toast(`${agent.name}: ${STATE_LABEL[rt.state]}`);
  } catch (err) {
    toast(String(err instanceof Error ? err.message : err), 'err');
  }
  refreshRuntime();
}

/** Launch the selected agent into the Workflow view (embedded, no external terminal). */
async function launchWorkflow(): Promise<void> {
  if (!selectedId) return;
  syncFormToProfile();
  if (!(await saveConfig(true))) return;
  const compressorSelect = document.getElementById('launch-bar-compressor-select') as HTMLSelectElement;
  const compressorId = compressorSelect?.value || config?.defaultCompressor || 'headroom';
  await addWorkflowSession(selectedId, compressorId);
}

async function stop(): Promise<void> {
  if (!selectedId) return;
  const agent = agents.find((a) => a.id === selectedId)!;
  const launchId = runtimes.get(selectedId)?.id ?? selectedId;
  const rt = await api.stop(launchId);
  runtimes.set(selectedId, rt);
  toast(`${agent.name} stopped`);
  refreshRuntime();
}

function refreshRuntime(): void {
  renderSidebar(el<HTMLInputElement>('agent-filter').value);
  updateLaunchBar();
  if (selectedId) {
    const rt = runtimeFor(selectedId);
    const state = el('agent-state');
    state.className = `state-dot state-${rt.state}`;
    state.title = STATE_LABEL[rt.state];
  }
}

/* ========================== Form synchronisation ======================= */

function syncFormToProfile(): void {
  if (!selectedId) return;
  const profile = currentProfile();
  profile.agentPath = el<HTMLInputElement>('fld-path').value.trim();
  profile.port = Number(el<HTMLInputElement>('fld-port').value) || profile.port;
  profile.autoPort = el<HTMLInputElement>('tgl-auto-port').checked;
  profile.workingDirectory = el<HTMLInputElement>('fld-workdir').value.trim();
  profile.mode = el<HTMLSelectElement>('fld-mode').value as 'token' | 'cache';
  profile.memory = el<HTMLInputElement>('tgl-memory').checked;
  profile.learn = el<HTMLInputElement>('tgl-learn').checked;
  profile.lossless = el<HTMLInputElement>('tgl-lossless').checked;
  profile.noOptimize = el<HTMLInputElement>('tgl-noopt').checked;
  profile.extraProxyArgs = el<HTMLInputElement>('fld-extra-proxy').value;
  profile.extraAgentArgs = el<HTMLInputElement>('fld-extra-agent').value;
}

/* ================================ Logs ================================= */

function renderLogs(): void {
  const view = el('logs-view');
  view.innerHTML = '';
  for (const entry of logEntries) appendLogLine(entry);
  scrollLogs();
}

function appendLogLine(entry: LogEntry): void {
  if (LOG_ORDER[entry.level] < LOG_ORDER[logThreshold]) return;
  const view = el('logs-view');
  const line = document.createElement('div');
  line.className = `log-line log-${entry.level}`;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false });
  const source = document.createElement('span');
  source.className = 'log-source';
  source.textContent = entry.source;
  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = entry.message;
  line.append(time, source, msg);
  view.appendChild(line);
  while (view.childElementCount > 1200) view.firstElementChild?.remove();
  scrollLogs();
}

function scrollLogs(): void {
  if (el<HTMLInputElement>('log-autoscroll').checked) {
    const view = el('logs-view');
    view.scrollTop = view.scrollHeight;
  }
}

/* ============================ Proxy status pill ============================ */

async function refreshHeadroomStatus(): Promise<void> {
  const pill = el('headroom-status');
  const text = el('headroom-status-text');
  const proxyId = config?.defaultCompressor || 'headroom';
  const proxyDef = PROXIES.find((p) => p.id === proxyId) || { name: proxyId.toUpperCase() };

  const installBanner = document.getElementById('proxy-install-banner');
  const installTitle = document.getElementById('proxy-not-found-title');
  const installDesc = document.getElementById('proxy-not-found-desc');
  const installBtn = document.getElementById('btn-install-proxy') as HTMLButtonElement | null;

  try {
    const result = await api.detectProxy(proxyId);
    if (result.found) {
      pill.className = 'pill pill-ok';
      text.textContent = `${proxyDef.name} detected`;
      if (installBanner) installBanner.classList.add('hidden');
    } else {
      pill.className = 'pill pill-bad';
      text.textContent = `${proxyDef.name} NOT FOUND`;
      if (installBanner) {
        installBanner.classList.remove('hidden');
        if (installTitle) installTitle.textContent = `⚠️ ${proxyDef.name} Not Found`;
        if (installDesc) installDesc.textContent = `${proxyDef.name} binary was not found on your system PATH or well-known locations.`;
        if (installBtn) {
          installBtn.textContent = `⚡ Install ${proxyDef.name} via CLI`;
          installBtn.onclick = async () => {
            installBtn.disabled = true;
            installBtn.textContent = `⏳ Installing ${proxyDef.name}...`;
            toast(`Executing CLI install for ${proxyDef.name}... Check logs for progress.`);
            try {
              const res = await api.installProxy(proxyId);
              if (res.ok) {
                toast(res.message);
                await refreshHeadroomStatus();
                if (selectedId) renderDetail();
              } else {
                toast(res.message, 'err');
              }
            } catch (err) {
              toast(String(err instanceof Error ? err.message : err), 'err');
            } finally {
              installBtn.disabled = false;
              installBtn.textContent = `⚡ Install ${proxyDef.name} via CLI`;
            }
          };
        }
      }
    }
  } catch (err) {
    pill.className = 'pill pill-unknown';
    text.textContent = `${proxyDef.name} error`;
  }
}

/* =========================== Settings modal =========================== */

// @ts-ignore (unused, settings moved to tab)
async function _openSettings(): Promise<void> {
  if (!config) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('h2');
  title.textContent = 'Studio settings';

  // Active proxy selector
  const proxyField = document.createElement('div');
  proxyField.className = 'field';
  const proxyLabel = document.createElement('label');
  proxyLabel.textContent = 'Active Proxy';
  const proxySelect = document.createElement('select');
  const proxies = await api.listProxies();
  for (const p of proxies) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    opt.selected = (config.defaultCompressor || 'headroom') === p.id;
    proxySelect.appendChild(opt);
  }
  proxyField.append(proxyLabel, proxySelect);

  // proxy binary path
  const pathField = document.createElement('div');
  pathField.className = 'field';
  const pathLabel = document.createElement('label');
  pathLabel.textContent = 'Proxy executable (empty = auto-detect)';
  const pathRow = document.createElement('div');
  pathRow.className = 'field-row';
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.placeholder = 'e.g. /usr/local/bin/headroom';
  pathInput.value = config.headroomPath;
  const browseBtn = document.createElement('button');
  browseBtn.className = 'btn';
  browseBtn.textContent = 'Browse…';
  const detectBtn = document.createElement('button');
  detectBtn.className = 'btn';
  detectBtn.textContent = 'Detect';
  pathRow.append(pathInput, browseBtn, detectBtn);
  const detectStatus = document.createElement('div');
  detectStatus.className = 'detect-status muted';
  pathField.append(pathLabel, pathRow, detectStatus);

  // startup timeout
  const timeoutField = document.createElement('div');
  timeoutField.className = 'field';
  const timeoutLabel = document.createElement('label');
  timeoutLabel.textContent = 'Proxy startup timeout (seconds)';
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.min = '5';
  timeoutInput.max = '300';
  timeoutInput.value = String(Math.round(config.proxyStartupTimeoutMs / 1000));
  timeoutField.append(timeoutLabel, timeoutInput);

  // theme
  const themeField = document.createElement('div');
  themeField.className = 'field';
  const themeLabel = document.createElement('label');
  themeLabel.textContent = 'Theme';
  const themeSelect = document.createElement('select');
  for (const [value, label] of [
    ['system', 'System (follows OS dark/light)'],
    ['dark', 'Dark'],
    ['light', 'Light'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = config.theme === value;
    themeSelect.appendChild(opt);
  }
  themeSelect.onchange = () => applyTheme(themeSelect.value as ThemeMode); // live preview
  themeField.append(themeLabel, themeSelect);

  const runDetect = async () => {
    detectStatus.textContent = 'Detecting…';
    const selectedProxy = proxySelect.value;
    const res = await api.detectProxy(selectedProxy, pathInput.value.trim() || undefined);
    detectStatus.textContent = res.found ? `Found: ${res.paths[0]}` : `Not found — configure binary path or install ${selectedProxy}`;
    detectStatus.style.color = res.found ? 'var(--ok)' : 'var(--err)';
    if (res.found && res.source !== 'explicit' && !pathInput.value) {
      detectStatus.textContent += ' (auto-detect will use this)';
    }
  };

  proxySelect.onchange = () => void runDetect();

  browseBtn.onclick = async () => {
    const picked = await api.pickExecutable();
    if (picked) {
      pathInput.value = picked;
      void runDetect();
    }
  };
  detectBtn.onclick = () => void runDetect();
  void runDetect();

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  actions.append(cancel, save);

  cancel.onclick = () => {
    applyTheme(config!.theme); // revert live preview
    overlay.remove();
  };
  save.onclick = async () => {
    config!.defaultCompressor = proxySelect.value;
    config!.headroomPath = pathInput.value.trim();
    config!.theme = themeSelect.value as ThemeMode;
    const seconds = Number(timeoutInput.value);
    config!.proxyStartupTimeoutMs =
      Number.isFinite(seconds) && seconds >= 5 && seconds <= 300
        ? Math.round(seconds * 1000)
        : config!.proxyStartupTimeoutMs;
    if (await saveConfig(true)) {
      applyTheme(config!.theme);
      overlay.remove();
      await refreshHeadroomStatus();
      toast('Settings saved');
    }
  };

  modal.append(title, proxyField, pathField, timeoutField, themeField, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/* ============================ Port checking ============================ */

function schedulePortCheck(): void {
  clearTimeout(portCheckTimer);
  portCheckTimer = setTimeout(async () => {
    const input = el<HTMLInputElement>('fld-port');
    const status = el('port-status');
    const killBtn = el<HTMLButtonElement>('btn-kill-port');
    const autoPort = el<HTMLInputElement>('tgl-auto-port').checked;
    if (autoPort) {
      status.textContent = 'auto-assigned at launch';
      status.style.color = 'var(--text-2)';
      killBtn.classList.add('hidden');
      return;
    }
    const port = Number(input.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      status.textContent = 'invalid port';
      status.style.color = 'var(--err)';
      killBtn.classList.add('hidden');
      return;
    }
    const free = await api.checkPort(port);
    status.textContent = free ? 'available' : 'in use';
    status.style.color = free ? 'var(--ok)' : 'var(--warn)';
    killBtn.classList.toggle('hidden', free);
  }, 350);
}

async function killPort(): Promise<void> {
  const port = Number(el<HTMLInputElement>('fld-port').value);
  if (!Number.isInteger(port)) return;
  el<HTMLButtonElement>('btn-kill-port').disabled = true;
  el<HTMLButtonElement>('btn-kill-port').textContent = 'Killing...';
  const result = await api.killPort(port);
  if (result.error) {
    toast(`Failed to kill port ${port}: ${result.error}`, 'err');
  } else {
    toast(`Killed processes on port ${port}`);
  }
  await new Promise((r) => setTimeout(r, 500));
  schedulePortCheck();
}

/* ================================ Init ================================= */

async function init(): Promise<void> {
  try {
    agents = await api.listAgents();
  config = await api.getConfig();
  applyTheme(config.theme);
  for (const rt of await api.runtimes()) runtimes.set(rt.agentId, rt);

  // sidebar filter
  el<HTMLInputElement>('agent-filter').oninput = (e) => renderSidebar((e.target as HTMLInputElement).value);

  // topbar
  el('btn-scan-all').onclick = async () => {
    el('btn-scan-all').setAttribute('disabled', '');
    try {
      const results = await api.scanAll();
      for (const r of results) scans.set(r.agentId, r);
      renderSidebar(el<HTMLInputElement>('agent-filter').value);
      if (selectedId) renderDetail();
      const found = results.filter((r) => r.found).length;
      toast(`Scan complete: ${found}/${results.length} agents detected`);
    } finally {
      el('btn-scan-all').removeAttribute('disabled');
    }
  };
  el('btn-logs-toggle').onclick = () => el('logs-panel').classList.toggle('collapsed');
  el('btn-settings').onclick = () => switchTab('settings');

  // detail form events (all mutate the in-memory profile)
  el<HTMLInputElement>('fld-path').oninput = (e) => { currentProfile().agentPath = (e.target as HTMLInputElement).value; };
  el<HTMLInputElement>('fld-port').oninput = (e) => {
    const profile = currentProfile();
    profile.port = Number((e.target as HTMLInputElement).value) || 0;
    // Editing the port means the user wants THAT port — disable auto-assign.
    profile.autoPort = false;
    const toggle = el<HTMLInputElement>('tgl-auto-port');
    if (toggle) toggle.checked = false;
    schedulePortCheck();
  };
  const autoPortToggle = el<HTMLInputElement>('tgl-auto-port');
  if (autoPortToggle) {
    autoPortToggle.onchange = (e) => {
      currentProfile().autoPort = (e.target as HTMLInputElement).checked;
      schedulePortCheck();
    };
  }
  el<HTMLInputElement>('fld-workdir').oninput = (e) => { currentProfile().workingDirectory = (e.target as HTMLInputElement).value; };
  el<HTMLSelectElement>('fld-mode').onchange = (e) => { currentProfile().mode = (e.target as HTMLSelectElement).value as 'token' | 'cache'; };
  el<HTMLInputElement>('tgl-memory').onchange = (e) => { currentProfile().memory = (e.target as HTMLInputElement).checked; };
  el<HTMLInputElement>('tgl-learn').onchange = (e) => { currentProfile().learn = (e.target as HTMLInputElement).checked; };
  el<HTMLInputElement>('tgl-lossless').onchange = (e) => { currentProfile().lossless = (e.target as HTMLInputElement).checked; };
  el<HTMLInputElement>('tgl-noopt').onchange = (e) => { currentProfile().noOptimize = (e.target as HTMLInputElement).checked; };
  el<HTMLInputElement>('fld-extra-proxy').oninput = (e) => { currentProfile().extraProxyArgs = (e.target as HTMLInputElement).value; };
  el<HTMLInputElement>('fld-extra-agent').oninput = (e) => { currentProfile().extraAgentArgs = (e.target as HTMLInputElement).value; };

  el('btn-browse').onclick = async () => {
    const picked = await api.pickExecutable();
    if (picked) {
      currentProfile().agentPath = picked;
      el<HTMLInputElement>('fld-path').value = picked;
    }
  };
  el('btn-browse-dir').onclick = async () => {
    const picked = await api.pickDirectory();
    if (picked) {
      currentProfile().workingDirectory = picked;
      el<HTMLInputElement>('fld-workdir').value = picked;
    }
  };
  el('btn-clear-path').onclick = () => {
    currentProfile().agentPath = '';
    el<HTMLInputElement>('fld-path').value = '';
  };
  el('btn-kill-port').onclick = () => void killPort();
  el('btn-scan-agent').onclick = async () => {
    if (!selectedId) return;
    const result = await api.scanAgent(selectedId, el<HTMLInputElement>('fld-path').value.trim());
    scans.set(selectedId, result);
    renderSidebar(el<HTMLInputElement>('agent-filter').value);
    renderDetail();
  };
  el('btn-open-config').onclick = () => {
    const agent = agents.find((a) => a.id === selectedId);
    if (agent) void api.openPath(agent.configFileHint.split(' ')[0]);
  };

  // active proxy selection
  const onProxyChange = async (e: Event) => {
    if (!config) return;
    const selectedProxy = (e.target as HTMLSelectElement).value;
    config.defaultCompressor = selectedProxy;
    await saveConfig(true);
    await refreshHeadroomStatus();
    renderDetail();
    if (activeTab === 'dashboard') renderDashboard();
    toast(`Active Token Optimizer set to ${selectedProxy.toUpperCase()}`);
  };
  const defaultCompEl = document.getElementById('fld-default-compressor') as HTMLSelectElement | null;
  if (defaultCompEl) defaultCompEl.onchange = onProxyChange;
  el<HTMLSelectElement>('launch-bar-compressor-select').onchange = onProxyChange;

  // tab navigation
  el('tab-btn-agents').onclick = () => switchTab('agents');
  el('tab-btn-compressors').onclick = () => switchTab('compressors');
  el('tab-btn-workflow').onclick = () => switchTab('workflow');
  el('tab-btn-settings').onclick = () => switchTab('settings');
  el('tab-btn-dashboard').onclick = () => switchTab('dashboard');
  el('btn-refresh-dash').onclick = () => {
    const iframe = el<HTMLIFrameElement>('dash-iframe');
    if (iframe && iframe.src) iframe.src = iframe.src;
    toast('Refreshed live dashboard');
  };
  el('btn-open-dash-browser').onclick = () => {
    const profile = selectedId ? currentProfile() : undefined;
    const port = profile?.port ?? 8989;
    void api.openUrl(`http://127.0.0.1:${port}/dashboard`);
  };

  // profiles
  el<HTMLSelectElement>('profile-select').onchange = (e) => {
    syncFormToProfile();
    agentConfig(selectedId!).activeProfile = (e.target as HTMLSelectElement).value;
    renderDetail();
  };
  el('btn-profile-saveas').onclick = async () => {
    syncFormToProfile();
    const ac = agentConfig(selectedId!);
    const name = await promptModal('Save profile as…', `${ac.activeProfile} copy`);
    if (!name) return;
    if (ac.profiles.some((p) => p.name === name)) {
      toast(`A profile named "${name}" already exists`, 'err');
      return;
    }
    ac.profiles.push({ ...currentProfile(), name, envOverrides: { ...currentProfile().envOverrides } });
    ac.activeProfile = name;
    await saveConfig(true);
    renderDetail();
    toast(`Profile "${name}" saved`);
  };
  el('btn-profile-delete').onclick = async () => {
    const ac = agentConfig(selectedId!);
    if (ac.profiles.length <= 1) return;
    if (!(await confirmModal(`Delete profile "${ac.activeProfile}"?`))) return;
    ac.profiles = ac.profiles.filter((p) => p.name !== ac.activeProfile);
    ac.activeProfile = ac.profiles[0].name;
    await saveConfig(true);
    renderDetail();
  };

  // env editor
  el('btn-env-add').onclick = () => addEnvRow(currentProfile());

  // launch
  el('btn-launch').onclick = () => void launch();
  el('btn-launch-workflow').onclick = () => void launchWorkflow();
  el('btn-stop').onclick = () => void stop();
  el('btn-save-config').onclick = async () => {
    syncFormToProfile();
    await saveConfig();
  };

  // logs
  logEntries = await api.logs();
  renderLogs();
  api.onLog((entry) => {
    logEntries.push(entry);
    if (logEntries.length > 3000) logEntries.splice(0, logEntries.length - 3000);
    appendLogLine(entry);
  });
  el<HTMLSelectElement>('log-level-filter').onchange = (e) => {
    logThreshold = (e.target as HTMLSelectElement).value as LogLevel;
    renderLogs();
  };
  el('btn-logs-clear').onclick = () => {
    void api.clearLogs();
    logEntries = [];
    renderLogs();
  };

  // runtime events
  api.onRuntime((rt) => {
    runtimes.set(rt.agentId, rt);
    refreshRuntime();
  });

  // workflow output listener
  setupWorkflowOutputListener();

  // initial paint
  renderSidebar();
  await refreshHeadroomStatus();

  // automatic system scan on startup
  const results = await api.scanAll();
  for (const r of results) scans.set(r.agentId, r);
  renderSidebar();

  // select first agent for a friendly first-run experience
  if (agents.length > 0 && !selectedId) selectAgent(agents[0].id);
  } catch (err) {
    console.error('Init error:', err);
    toast('Failed to initialize: ' + String(err), 'err');
  }
}

void init();
