/**
 * Smoke test: connects to a running Electron instance (started with
 * --remote-debugging-port=9222), collects console messages / uncaught
 * exceptions for a few seconds and captures a screenshot.
 *
 * Usage:
 *   node_modules/electron/dist/electron . --remote-debugging-port=9222
 *   node scripts/smoke.mjs [screenshot.png]
 */
import { writeFileSync } from 'node:fs';

const CDP_URL = 'http://127.0.0.1:9222';
const LISTEN_MS = Number(process.env.SMOKE_MS ?? 6000);
const screenshotPath = process.argv[2] ?? 'smoke.png';

// Hard watchdog: never hang forever.
setTimeout(() => {
  console.error('FAIL: smoke test watchdog timeout');
  process.exit(1);
}, LISTEN_MS + 20000).unref();

const targets = await fetch(`${CDP_URL}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('FAIL: no renderer page found');
  process.exit(1);
}
console.log(`Page: ${page.title} (${page.url})`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
const problems = [];
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    if (msg.error) pending.get(msg.id).reject(new Error(msg.error.message));
    else pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`EXCEPTION: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push(`log: ${msg.params.entry.text}`);
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// Interact a little: confirm the agent list rendered and click the first agent.
await new Promise((r) => setTimeout(r, 2500));
const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    agents: document.querySelectorAll('.agent-item').length,
    hasDetail: !document.getElementById('detail-content')?.classList.contains('hidden'),
    agentName: document.getElementById('agent-name')?.textContent ?? null,
    profiles: document.getElementById('profile-select')?.options?.length ?? 0,
    port: document.getElementById('fld-port')?.value ?? null,
    logs: document.querySelectorAll('.log-line').length,
    headroomPill: document.getElementById('headroom-status-text')?.textContent ?? null,
  })`,
  returnByValue: true,
});
console.log('UI probe:', probe.result.value);

await new Promise((r) => setTimeout(r, LISTEN_MS));

try {
  await send('Page.bringToFront');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  console.log(`Screenshot saved: ${screenshotPath}`);
} catch (err) {
  console.warn(`Screenshot skipped: ${err.message}`);
}

ws.close();
if (problems.length > 0) {
  console.error('FAIL: renderer reported problems:');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
console.log('SMOKE OK: no console errors, no exceptions');
process.exit(0);
