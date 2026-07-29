/**
 * End-to-end launch test: drives the real UI over CDP.
 *
 * To avoid interfering with real agent installs / ports on this machine it
 * configures the Grok profile with a fake agent binary (scripts/fake-agent.cmd)
 * and a dedicated test port (8899), then verifies the full lifecycle:
 *
 *   select agent -> configure -> launch -> proxy ready -> agent spawn/exit
 *   -> proxy stays up -> stop -> proxy gone.
 *
 * Requires: electron . --remote-debugging-port=9222
 */
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const CDP_URL = 'http://127.0.0.1:9222';
const TEST_PORT = 8899;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fakeAgent = join(root, 'scripts', 'fake-agent.cmd');

const targets = await fetch(`${CDP_URL}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no renderer page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + (res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};

let failed = false;
const step = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
};

const proxyAnswers = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/livez`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
};

// 1. Select Grok in the sidebar (never touches the real grok.exe — see step 2)
await evaluate(`[...document.querySelectorAll('.agent-item')].find(i => i.dataset.agentId === 'grok').click()`);
await new Promise((r) => setTimeout(r, 400));
step('select grok', (await evaluate(`document.getElementById('agent-name').textContent`)) === 'Grok CLI');

// 2. Configure fake agent binary + test port through the real form
await evaluate(`(() => {
  const path = document.getElementById('fld-path');
  path.value = ${JSON.stringify(fakeAgent)};
  path.dispatchEvent(new Event('input'));
  const port = document.getElementById('fld-port');
  port.value = '${TEST_PORT}';
  port.dispatchEvent(new Event('input'));
})()`);
step('form configured', (await evaluate(`document.getElementById('fld-port').value`)) === String(TEST_PORT));

// 3. Launch through Headroom (first proxy boot loads ML models — allow 90s)
await evaluate(`document.getElementById('btn-launch').click()`);
let status = '';
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 800));
  status = await evaluate(`document.getElementById('launch-status').textContent`);
  if (/Running|Proxy running|error/i.test(status)) break;
}
console.log('  launch status:', JSON.stringify(status));
step('launch reached running/proxy-up', /Running|Proxy running/i.test(status));
step('proxy answers on test port', await proxyAnswers());
step('stop button shown', await evaluate(`!document.getElementById('btn-stop').classList.contains('hidden')`));

// 4. Fake agent exits immediately -> runtime should settle at proxy-up
//    (Windows terminal teardown can lag — poll up to 12s)
let settled = '';
const settleDeadline = Date.now() + 12000;
while (Date.now() < settleDeadline) {
  await new Promise((r) => setTimeout(r, 1000));
  settled = await evaluate(`document.getElementById('launch-status').textContent`);
  if (/Proxy running/i.test(settled)) break;
}
console.log('  settled status:', JSON.stringify(settled));
step('proxy stays up after agent exit', /Proxy running/i.test(settled));

// 5. Stop -> proxy gone, launch button back
await evaluate(`document.getElementById('btn-stop').click()`);
await new Promise((r) => setTimeout(r, 3000));
step('proxy shut down', !(await proxyAnswers()));
step('launch button back', await evaluate(`!document.getElementById('btn-launch').classList.contains('hidden')`));

// 6. Logs captured the lifecycle
const logText = await evaluate(`document.getElementById('logs-view').textContent`);
step('logs contain proxy lifecycle', /proxy|8899/i.test(logText));

// 7. Restore the profile to defaults (clear fake path, restore Grok port 8791)
await evaluate(`(() => {
  const path = document.getElementById('fld-path');
  path.value = '';
  path.dispatchEvent(new Event('input'));
  const port = document.getElementById('fld-port');
  port.value = '8791';
  port.dispatchEvent(new Event('input'));
  document.getElementById('btn-save-config').click();
})()`);
await new Promise((r) => setTimeout(r, 800));
step('profile restored', (await evaluate(`document.getElementById('fld-port').value`)) === '8791');

ws.close();
console.log(failed ? 'E2E FAILED' : 'E2E OK');
process.exit(failed ? 1 : 0);
