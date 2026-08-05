# GUI Test Loop — workflow spec

**Loop:** TokenZero Studio GUI testing — run the app, drive it like a real user, find issues, fix, rebuild, re-verify. Triggered whenever the user says "test the GUI", after any renderer change, or after a sibling session commits.

## Trigger

- **Event:** user asks to test/find issues in the app; or a commit lands touching `src/renderer/*`, `src/main/ipc.ts`, `src/core/proxies/*`, `src/preload/*`
- **Event:** user reports a runtime symptom (install not detected, logs flooded, tab missing)

## Steps

1. **Build + launch instrumented.** `npm run test && npm run typecheck && npm run build`, then launch with remote debugging:
   `node scripts/build.mjs && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron . --remote-debugging-port=9222` (background)
2. **Attach via CDP.** Get the page ws URL: `curl -s http://127.0.0.1:9222/json` → `webSocketDebuggerUrl`. Drive with `/tmp/cdp.mjs <ws> <expr>` (Runtime.evaluate, returnByValue) — click tabs, read DOM state, verify buttons/handlers.
3. **Verify every tab.** Agents, Compressors, Workflow, Settings, Dashboard: view visible, key elements present, handlers wired (`typeof el.onclick === 'function'`), no `hidden` class where there should be a view.
4. **Exercise a real workflow.** On Compressors: select a compressor → click Detect → assert status text contains "Found at" with a real path. Check install options dropdown shows durable option first, ephemeral (npx) flagged.
5. **Read the app log for runtime errors.** The Electron process log (kill output / terminal poll) surfaces `ERR_BLOCKED_BY_CSP`, spawn failures, "binary not found" — these are the high-value bugs.
6. **Fix, commit, rebuild, re-launch, re-verify.** One commit per issue; keep the tree green after each.

## Checkpoint

- **Push right:** fix and verify everything drivable before reporting. Only report to the user once per batch, with a brief: issues found, what was fixed, verification evidence.
- **Brief format:** bullet list of issues → fix commit hashes → one-line evidence each (e.g. "Detect now returns Found at /Users/.../.local/bin/pxpipe").

## Files that change

- `src/renderer/index.html` (tabs, buttons, CSP), `src/renderer/app.ts` (handlers), `src/renderer/styles.css`
- `src/main/ipc.ts` (new IPC handlers), `src/preload/index.ts`, `src/shared/types.ts`
- `src/core/proxy-install.ts`, `src/core/proxies/registry.ts` (catalog / detection)
- `tests/*.test.ts` (regression for each fix)

## Definition of done

All tabs render, all management buttons wired, detect/install/update/remove resolve against the real system, full suite green (`npm run test`), typecheck clean, build emits `dist/`.
