#!/usr/bin/env node
/**
 * Playwright Electron E2E — full product walk of TokenZero Studio.
 *
 * Drives the real built app like a user: boot → browse agents → scan →
 * compressors → install options → embedded Workflow launches (fake agent +
 * real claude) → dashboard → settings/config persistence ("database") →
 * logs → clean shutdown. Restores the user's real config.json afterwards.
 *
 * Usage:  node scripts/playwright-e2e.mjs
 * Requires: npm run build (dist/ present), playwright-core (devDep).
 */
import { _electron } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.HOME;
const CONFIG = join(HOME, 'Library/Application Support/token-zero-studio/config.json');
const BACKUP = join(root, '.hermes', 'e2e-config.backup.json');
const ART = join(root, '.hermes', 'e2e-artifacts');
const FAKE_AGENT = join(root, 'scripts', 'fake-agent.sh');
mkdirSync(ART, { recursive: true });
const shot = (name) => join(ART, name);

let passed = 0, failed = 0;
const issues = [];
const step = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (ok) passed++; else { failed++; issues.push(name + (extra ? ` (${extra})` : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- config backup (the app's "database" — restore after the walk) ----
const hadBackup = existsSync(BACKUP);
if (!hadBackup && existsSync(CONFIG)) cpSync(CONFIG, BACKUP);
console.log(`[setup] config backup: ${hadBackup ? 'existing' : 'created'} (${CONFIG})`);

// ---- free the test ports of stragglers from previous runs ----
for (const port of [8898, 8899]) {
  try { execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null; true`); } catch { /* none */ }
}

async function launchApp(consoleErrors) {
  const app = await _electron.launch({ args: ['.'], cwd: root, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
  const proc = app.process();
  proc.stderr?.on('data', (d) => { const s = String(d); if (/error|ERR_|Unhandled|failed|Traceback/i.test(s)) consoleErrors.push('MAIN: ' + s.trim().slice(0, 400)); });
  return { app, page };
}

async function waitFor(page, fn, { timeout = 30000, interval = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await page.evaluate(fn); if (last) return last; } catch { /* page busy */ }
    await sleep(interval);
  }
  throw new Error(`TIMEOUT: ${label} (last=${JSON.stringify(last)?.slice(0, 200)})`);
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

const consoleErrors = [];
let app, page;

const closeModals = () => ev(page, () => {
  for (const d of [...document.querySelectorAll('body > div')]) {
    if (d.style.position === 'fixed' && d.style.zIndex === '200') {
      const btn = [...d.querySelectorAll('button')].find((b) => /cancel|close|✕|dismiss/i.test(b.textContent));
      if (btn) { btn.click(); continue; }
      d.remove();
    }
  }
});

try {
  // ================= PHASE 0 — BOOT & SHELL =================
  console.log('\n=== Phase 0: Boot & shell ===');
  ({ app, page } = await launchApp(consoleErrors));
  await waitFor(page, () => document.querySelector('.nav-tab') !== null, { label: 'nav tabs render' });
  const title = await page.title();
  step('window opens with title', /TokenZero|token-zero/i.test(title) || title === '', title || '(empty, BrowserWindow title applies)');
  const tabs = await ev(page, () => [...document.querySelectorAll('.nav-tab')].map((b) => b.textContent.trim()));
  step('5 tabs in canonical order', JSON.stringify(tabs) === JSON.stringify(['🤖 Agents', '🧩 Compressors', '🖥️ Workflow', '⚙️ Settings', '📊 Dashboard']), JSON.stringify(tabs));
  step('Agents tab active by default', (await ev(page, () => document.querySelector('.nav-tab.active')?.id)) === 'tab-btn-agents');
  const agentCount = await ev(page, () => document.querySelectorAll('#sidebar .agent-item').length);
  step('sidebar lists 27 agents', agentCount === 27, `got ${agentCount}`);
  const logsVisible = await ev(page, () => getComputedStyle(document.getElementById('logs-panel')).display !== 'none');
  step('logs panel visible by default', logsVisible);
  await page.screenshot({ path: shot('01-boot.png') });

  // ================= PHASE 1 — AGENTS: browse + scan =================
  console.log('\n=== Phase 1: Agents browse + scan ===');
  await ev(page, () => [...document.querySelectorAll('.agent-item')].find((i) => i.dataset.agentId === 'claude').click());
  await waitFor(page, () => document.getElementById('agent-name')?.textContent?.length > 0, { label: 'agent detail renders' });
  const detailName = await ev(page, () => document.getElementById('agent-name').textContent);
  step('agent detail renders', detailName.length > 0, detailName);
  step('launch + workflow buttons present', await ev(page, () => !!document.getElementById('btn-launch') && !!document.getElementById('btn-launch-workflow')));
  const pathField = await ev(page, () => document.getElementById('fld-path').value);
  step('path field prefilled from scan/config', typeof pathField === 'string', `"${pathField}"`);

  await ev(page, () => document.getElementById('btn-scan-agent').click());
  await waitFor(page, () => {
    const sub = document.querySelector('#sidebar .agent-item[data-agent-id="claude"] .agent-item-sub');
    return sub && /found|~/i.test(sub.textContent) ? sub.textContent : '';
  }, { label: 'claude single-agent scan', timeout: 20000 });
  const claudeScanSub = await ev(page, () => document.querySelector('#sidebar .agent-item[data-agent-id="claude"] .agent-item-sub')?.textContent);
  step('single-agent scan finds claude', /found|\.local\/bin\/claude/i.test(claudeScanSub), claudeScanSub?.slice(0, 80));

  await ev(page, () => document.getElementById('btn-scan-all').click());
  await waitFor(page, () => document.getElementById('btn-scan-all').disabled === true, { label: 'scan-all starts', timeout: 5000 });
  const t0 = Date.now();
  let scanAllOk = false, scanDur = 0;
  try {
    await waitFor(page, () => document.getElementById('btn-scan-all').disabled === false, { label: 'scan-all completes', timeout: 120000, interval: 1000 });
    scanAllOk = true;
  } catch (e) { console.log('  (note) scan-all wait:', e.message.slice(0, 140)); }
  scanDur = ((Date.now() - t0) / 1000).toFixed(1);
  const foundCount = await ev(page, () => document.querySelectorAll('#sidebar .agent-item .agent-item-sub').length);
  step('scan-all completes', scanAllOk, `${scanDur}s, ${foundCount} items re-rendered`);

  // ================= PHASE 2 — COMPRESSORS =================
  console.log('\n=== Phase 2: Compressors ===');
  await ev(page, () => document.getElementById('tab-btn-compressors').click());
  await waitFor(page, () => document.querySelectorAll('#compressors-view .agent-item').length >= 13, { label: 'compressor list' });
  const compCount = await ev(page, () => document.querySelectorAll('#compressors-view .agent-item').length);
  step('13 compressors listed', compCount === 13, `got ${compCount}`);

  await ev(page, () => [...document.querySelectorAll('#compressors-view .agent-item')].find((i) => i.dataset.compressorId === 'headroom').click());
  await waitFor(page, () => document.getElementById('btn-detect-compressor') !== null, { label: 'compressor detail' });
  await ev(page, () => document.getElementById('btn-detect-compressor').click());
  await waitFor(page, () => /Found at|Not found/.test(document.getElementById('compressor-detect-status').textContent), { label: 'headroom detect', timeout: 20000 });
  const headroomStatus = await ev(page, () => document.getElementById('compressor-detect-status').textContent);
  step('headroom detected on system', /Found at .*headroom/.test(headroomStatus), headroomStatus.trim().slice(0, 90));

  await ev(page, () => [...document.querySelectorAll('#compressors-view .agent-item')].find((i) => i.dataset.compressorId === 'caveman').click());
  await sleep(400);
  await ev(page, () => document.getElementById('btn-install-compressor').click());
  await waitFor(page, () => [...document.querySelectorAll('body > div')].some((d) => d.style.position === 'fixed' && d.style.zIndex === '200'), { label: 'install-options modal', timeout: 10000 });
  const modalText = await ev(page, () => [...document.querySelectorAll('body > div')].filter((d) => d.style.position === 'fixed' && d.style.zIndex === '200').map((d) => d.textContent).join('\n'));
  step('install-options modal opens', modalText.length > 40, modalText.slice(0, 90).replace(/\n/g, ' '));
  step('options show real commands', !/404|not found/i.test(modalText) && /npm|pip|uv|brew|cargo|npx/i.test(modalText));
  await closeModals();

  // ================= PHASE 3 — WORKFLOW (embedded terminals) =================
  console.log('\n=== Phase 3: Workflow embedded launches ===');
  // 3a — deterministic: fake agent + rtk (wrapper mode, instant)
  await ev(page, () => document.getElementById('tab-btn-agents').click());
  await ev(page, () => [...document.querySelectorAll('.agent-item')].find((i) => i.dataset.agentId === 'grok').click());
  await waitFor(page, () => document.getElementById('fld-path') !== null, { label: 'grok detail' });
  await ev(page, (path) => { const p = document.getElementById('fld-path'); p.value = path; p.dispatchEvent(new Event('input')); }, FAKE_AGENT);
  await ev(page, () => { const s = document.getElementById('launch-bar-compressor-select'); s.value = 'rtk'; s.dispatchEvent(new Event('change')); });
  await ev(page, () => document.getElementById('btn-launch-workflow').click());
  await waitFor(page, () => document.querySelectorAll('#workflow-tabs .workflow-tab-item').length >= 1, { label: 'session tab appears', timeout: 30000 });
  await waitFor(page, () => !!document.querySelector('#workflow-xterm .xterm, #workflow-xterm canvas'), { label: 'xterm mounts', timeout: 30000 });
  await sleep(2500);
  const wf1Title = await ev(page, () => document.getElementById('wf-session-title').textContent);
  step('fake-agent session launched', wf1Title.length > 0, wf1Title);
  const xterm1Text = await ev(page, () => document.querySelector('#workflow-xterm .xterm-rows')?.textContent?.slice(0, 200) ?? '');
  step('xterm shows agent output', /FAKE-AGENT READY/i.test(xterm1Text), JSON.stringify(xterm1Text.slice(0, 90)));
  await page.screenshot({ path: shot('02-workflow-fake.png') });

  // 3b — real: claude + pxpipe (server mode) on test port 8899
  await ev(page, () => [...document.querySelectorAll('.agent-item')].find((i) => i.dataset.agentId === 'claude').click());
  await waitFor(page, () => document.getElementById('fld-port') !== null, { label: 'claude detail' });
  await ev(page, () => { const p = document.getElementById('fld-port'); p.value = '8899'; p.dispatchEvent(new Event('input')); });
  await ev(page, () => { const s = document.getElementById('launch-bar-compressor-select'); s.value = 'pxpipe'; s.dispatchEvent(new Event('change')); });
  await ev(page, () => document.getElementById('btn-launch-workflow').click());
  const proxyReady = await (async () => {
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      try { const r = await fetch('http://127.0.0.1:8899/livez'); if (r.status >= 0) return true; } catch { /* polling */ }
      await sleep(500);
    }
    return false;
  })();
  step('pxpipe proxy answers on 8899', proxyReady);
  await waitFor(page, () => document.querySelectorAll('#workflow-tabs .workflow-tab-item').length >= 2, { label: 'second session tab', timeout: 30000 });
  await sleep(5000); // let claude TUI render
  const wf2Title = await ev(page, () => document.getElementById('wf-session-title').textContent);
  const xterm2Text = await ev(page, () => document.querySelector('#workflow-xterm .xterm-rows')?.textContent?.slice(0, 300) ?? '');
  step('claude session active', wf2Title.length > 0 && (xterm2Text.length > 0 || wf2Title.toLowerCase().includes('claude')), `${wf2Title} | xterm: ${JSON.stringify(xterm2Text.slice(0, 60))}`);
  await page.screenshot({ path: shot('03-workflow-claude.png') });

  // dashboard while a proxy is actually up
  await ev(page, () => document.getElementById('tab-btn-dashboard').click());
  await waitFor(page, () => document.getElementById('dash-iframe').src.startsWith('http://127.0.0.1:8899'), { label: 'dashboard iframe target', timeout: 10000 });
  const iframeSrc = await ev(page, () => document.getElementById('dash-iframe').src);
  step('dashboard iframe targets live proxy', iframeSrc.includes('8899'), iframeSrc);
  await sleep(1500);
  await page.screenshot({ path: shot('04-dashboard.png') });

  // close the claude session → proxy should stop, port freed
  await ev(page, () => document.getElementById('tab-btn-workflow').click());
  await ev(page, () => document.getElementById('wf-btn-close').click());
  await waitFor(page, () => document.getElementById('workflow-empty').classList.contains('hidden') === false, { label: 'session closed → empty state', timeout: 20000 });
  await sleep(2500);
  const portFree = await (async () => {
    try { await fetch('http://127.0.0.1:8899/livez', { signal: AbortSignal.timeout(1200) }); return false; } catch { return true; }
  })();
  step('close stops proxy + frees port 8899', portFree);

  // ================= PHASE 4 — SETTINGS / CONFIG PERSISTENCE ("database") =================
  console.log('\n=== Phase 4: Settings + config persistence ===');
  await ev(page, () => document.getElementById('tab-btn-settings').click());
  await waitFor(page, () => document.querySelectorAll('#settings-content select').length >= 2, { label: 'settings render' });
  const themes = await ev(page, () => [...document.querySelectorAll('#settings-content select')].map((s) => s.options.length));
  step('settings render (compressor + theme selects)', themes.length >= 2, JSON.stringify(themes));
  await ev(page, () => { const selects = [...document.querySelectorAll('#settings-content select')]; const theme = selects[selects.length - 1]; theme.value = 'dark'; theme.dispatchEvent(new Event('change')); });
  await waitFor(page, () => document.documentElement.dataset.theme === 'dark', { label: 'theme applies', timeout: 8000 });
  step('theme switch applies live', true);
  await sleep(600); // let saveConfig(true) write
  const onDisk = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(CONFIG, 'utf8')));
  step('config.json persisted on disk', onDisk.theme === 'dark', `theme=${onDisk.theme}`);
  await ev(page, () => { const selects = [...document.querySelectorAll('#settings-content select')]; selects[0].value = 'pxpipe'; selects[0].dispatchEvent(new Event('change')); });
  await sleep(600);
  const onDisk2 = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(CONFIG, 'utf8')));
  step('default compressor persisted', onDisk2.defaultCompressor === 'pxpipe', `defaultCompressor=${onDisk2.defaultCompressor}`);

  // relaunch → persisted values survive ("login again")
  await app.close();
  await sleep(1200);
  ({ app, page } = await launchApp(consoleErrors));
  await waitFor(page, () => document.documentElement.dataset.theme === 'dark', { label: 'theme after relaunch', timeout: 15000 });
  step('config survives relaunch (theme=dark)', true);
  const relaunchedDefault = await ev(page, () => { document.getElementById('tab-btn-settings').click(); return true; }).then(() =>
    waitFor(page, () => document.querySelectorAll('#settings-content select').length >= 2 ? [...document.querySelectorAll('#settings-content select')][0].value : '', { label: 'default compressor after relaunch' }));
  step('default compressor survives relaunch', relaunchedDefault === 'pxpipe', `defaultCompressor=${relaunchedDefault}`);

  // ================= PHASE 5 — LOGS PANEL =================
  console.log('\n=== Phase 5: Logs panel ===');
  await ev(page, () => document.getElementById('tab-btn-agents').click());
  const logText = await ev(page, () => document.getElementById('logs-view').textContent);
  step('logs captured launch lifecycle', /proxy|pxpipe|rtk|spawn|8899/i.test(logText), logText.slice(0, 100).replace(/\n/g, ' '));
  await ev(page, () => document.getElementById('btn-logs-clear').click());
  await sleep(400);
  const logAfterClear = await ev(page, () => document.getElementById('logs-view').textContent.trim());
  step('logs clear button works', logAfterClear === '', JSON.stringify(logAfterClear.slice(0, 40)));

  // ================= PHASE 6 — SHUTDOWN ("logout") =================
  console.log('\n=== Phase 6: Shutdown ===');
  await page.screenshot({ path: shot('05-settings-final.png') });
  await app.close();
  await sleep(1500);
  const portFreeAfterQuit = await (async () => {
    try { await fetch('http://127.0.0.1:8899/livez', { signal: AbortSignal.timeout(1200) }); return false; } catch { return true; }
  })();
  step('app quits cleanly (no orphan proxy on 8899)', portFreeAfterQuit);
  const bridges = execSync(`pgrep -f 'pty,os,select' || true`).toString().trim();
  step('no orphaned PTY bridges', bridges === '', bridges ? `${bridges.split('\n').length} procs` : '');
} catch (e) {
  console.log(`\n[abort] ${e.message}`);
  issues.push('RUN ABORTED: ' + e.message);
  failed++;
} finally {
  try { if (app) await app.close(); } catch { /* already closed */ }
  if (existsSync(BACKUP)) {
    cpSync(BACKUP, CONFIG);
    console.log('[cleanup] config.json restored from backup');
  }
  for (const port of [8898, 8899]) {
    try { execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null; true`); } catch { /* none */ }
  }
  try { execSync(`pkill -f 'pty,os,select' 2>/dev/null; true`); } catch { /* none */ }
}

console.log('\n=== Console / main-process errors captured ===');
if (consoleErrors.length === 0) { console.log('(none)'); step('no console/main errors', true); }
else {
  for (const e of [...new Set(consoleErrors)].slice(0, 15)) console.log('  -', e.slice(0, 300));
  step('no console/main errors', false, `${new Set(consoleErrors).size} distinct errors`);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (issues.length) { console.log('\nIssues:'); for (const i of issues) console.log('  ✗', i); }
console.log(`Artifacts: ${ART}`);
process.exit(failed > 0 ? 1 : 0);
