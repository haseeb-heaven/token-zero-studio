import type { HeadroomApi } from '../preload/index';
import { resolveTheme } from '../core/theme';
import { PROXIES } from '../core/proxies/registry';
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
  el<HTMLInputElement>('fld-workdir').value = profile.workingDirectory;
  el('agent-config-hint').textContent = agent.configFileHint || '-';
  el('port-status').textContent = '';
  renderDetectedPaths(agent, scan);

  // proxy options
  const activeProxyId = config?.activeProxy || 'headroom';
  const proxyObj = PROXIES.find((p) => p.id === activeProxyId);
  const activeProxyName = proxyObj?.name || 'Custom';
  const launchBtn = el('btn-launch');
  if (launchBtn) launchBtn.textContent = `▶ Launch ${agent.name} with ${activeProxyName}`;

  const activeSelect = el<HTMLSelectElement>('fld-active-proxy');
  if (activeSelect) activeSelect.value = activeProxyId;

  const barSelect = el<HTMLSelectElement>('launch-bar-proxy-select');
  if (barSelect) barSelect.value = activeProxyId;

  const descBanner = el('proxy-desc-banner');
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
    } else if (activeProxyId === 'litellm') {
      descBanner.textContent = 'LiteLLM: AI proxy gateway with context compression and fallback middleware.';
    } else {
      descBanner.textContent = 'Custom Proxy: User-defined proxy binary and endpoint.';
    }
  }

  const headroomRow = el('headroom-options-row');
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

let activeTab: 'agents' | 'dashboard' = 'agents';

function switchTab(tab: 'agents' | 'dashboard'): void {
  activeTab = tab;
  const agentsTabBtn = el('tab-btn-agents');
  const dashTabBtn = el('tab-btn-dashboard');
  const detailView = el('detail');
  const sidebarView = el('sidebar');
  const dashView = el('dashboard-view');

  if (tab === 'agents') {
    agentsTabBtn?.classList.add('active');
    dashTabBtn?.classList.remove('active');
    detailView?.classList.remove('hidden');
    sidebarView?.classList.remove('hidden');
    dashView?.classList.add('hidden');
  } else {
    dashTabBtn?.classList.add('active');
    agentsTabBtn?.classList.remove('active');
    detailView?.classList.add('hidden');
    sidebarView?.classList.add('hidden');
    dashView?.classList.remove('hidden');
    renderDashboard();
  }
}

function renderDashboard(): void {
  if (!config) return;
  const activeProxyId = config.activeProxy || 'headroom';
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
    const rt = await api.start(selectedId);
    runtimes.set(selectedId, rt);
    toast(`${agent.name}: ${STATE_LABEL[rt.state]}`);
  } catch (err) {
    toast(String(err instanceof Error ? err.message : err), 'err');
  }
  refreshRuntime();
}

async function stop(): Promise<void> {
  if (!selectedId) return;
  const agent = agents.find((a) => a.id === selectedId)!;
  const rt = await api.stop(selectedId);
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
  const proxyId = config?.activeProxy || 'headroom';
  try {
    const result = await api.detectProxy(proxyId);
    if (result.found) {
      pill.className = 'pill pill-ok';
      text.textContent = `${proxyId.toUpperCase()} detected`;
      pill.title = result.paths[0];
    } else {
      pill.className = 'pill pill-bad';
      text.textContent = `${proxyId.toUpperCase()} not found`;
      pill.title = `Install ${proxyId} proxy or set explicit path in Settings`;
    }
  } catch {
    pill.className = 'pill pill-bad';
    text.textContent = 'Detection failed';
  }
}

/* =========================== Settings modal =========================== */

async function openSettings(): Promise<void> {
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
    opt.selected = (config.activeProxy || 'headroom') === p.id;
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
    config!.activeProxy = proxySelect.value;
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

let portCheckTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePortCheck(): void {
  clearTimeout(portCheckTimer);
  portCheckTimer = setTimeout(async () => {
    const input = el<HTMLInputElement>('fld-port');
    const status = el('port-status');
    const killBtn = el<HTMLButtonElement>('btn-kill-port');
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
  el('btn-settings').onclick = () => openSettings();

  // detail form events (all mutate the in-memory profile)
  el<HTMLInputElement>('fld-path').oninput = (e) => { currentProfile().agentPath = (e.target as HTMLInputElement).value; };
  el<HTMLInputElement>('fld-port').oninput = (e) => {
    currentProfile().port = Number((e.target as HTMLInputElement).value) || 0;
    schedulePortCheck();
  };
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
    config.activeProxy = selectedProxy;
    await saveConfig(true);
    await refreshHeadroomStatus();
    renderDetail();
    if (activeTab === 'dashboard') renderDashboard();
    toast(`Active Token Optimizer set to ${selectedProxy.toUpperCase()}`);
  };
  el<HTMLSelectElement>('fld-active-proxy').onchange = onProxyChange;
  el<HTMLSelectElement>('launch-bar-proxy-select').onchange = onProxyChange;

  // tab navigation
  el('tab-btn-agents').onclick = () => switchTab('agents');
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

  // initial paint
  renderSidebar();
  await refreshHeadroomStatus();

  // automatic system scan on startup
  const results = await api.scanAll();
  for (const r of results) scans.set(r.agentId, r);
  renderSidebar();

  // select first agent for a friendly first-run experience
  if (agents.length > 0 && !selectedId) selectAgent(agents[0].id);
}

void init();
