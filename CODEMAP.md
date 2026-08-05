# CODEMAP.md — full code map of token-zero-studio

Generated 2026-08-05 from the `develop` branch. Backend = Electron main +
preload + pure core. Frontend = renderer. All shared types/IPC live in
`src/shared/types.ts`. ~14k lines of TS in `src/`, ~7.3k lines of tests in
27 test files.

## Process/layer diagram

```
┌────────────────────────── FRONTEND ──────────────────────────┐
│ src/renderer/app.ts (1855L)  — vanilla TS, imperative DOM     │
│   tabs: agents | compressors | workflow | settings | dashboard│
│   + index.html (CSP, 5 view panes) + styles.css (566L)        │
└───────────────▲───────────────────────────────────────────────┘
                │ window.headroom (typed API, src/preload/index.ts, 133L)
                │ contextBridge.exposeInMainWorld('headroom', api)
┌───────────────┴───────────────────────────────────────────────┐
│ src/main/  — Electron main process (backend glue)              │
│   index.ts (67L)  window creation, theme, EPIPE guards         │
│   ipc.ts (1015L) 34× ipcMain.handle, real spawn/net/fetch      │
└───────▲──────────────────────────────▲─────────────────────────┘
        │ IPC channel map (IPC const)  │
┌───────┴──────────────────────────────┴─────────────────────────┐
│ src/core/  — PURE logic, zero Electron/Node imports (testable) │
│ src/shared/types.ts (313L) — all types + IPC channel map       │
└────────────────────────────────────────────────────────────────┘
```

## Backend

### src/main (Electron main process — thin, untested, excluded from coverage)

| File | Role |
|---|---|
| `index.ts` (67L) | App lifecycle: create 1360×880 window (contextIsolation, sandbox, no nodeIntegration), theme from config, EPIPE-tolerant error handlers, calls `Shutdown()` on quit. |
| `ipc.ts` (1015L) | **The whole backend surface.** `registerIpc()` wires 34 `ipcMain.handle` channels to core modules with real `child_process.spawn`, `net` port checks, `fetch` readiness. Also `currentConfig()`, `Shutdown()` (kills all runtimes + proxies). |

### src/core (pure logic — the testable heart, ~4.9k lines)

| File | Responsibility | Key exports |
|---|---|---|
| `agents.ts` (563L) | Registry of **27 agents** (aider, antigravity, claude, cline, codex, commandcode, continue, copilot, cursor, devin, gemini, goose, grok, grok-build, kimi, omp, openclaude, openclaw, opencode, openhands, pi-coding, replit, roo, t3, vibe, windsurf, zcode) with executables, well-known paths, envStyle, defaultPort. | `AGENTS`, `getAgent(id)`, `hasAgent(id)` |
| `proxies/types.ts` (64L) | ProxyDefinition shape: mode (`server`/`wrapper`), envStyle (`anthropic`/`openai`/`both`/`none`), flags. | `ProxyDefinition`, `buildProxyEnv(def, port)` |
| `proxies/registry.ts` (342L) | Registry of **13 compressors**: headroom, rtk, pxpipe, llmlingua, tokenshift, caveman, leanctx, supercompress, selective-ctx, squeez, omni-route, graphify, ponytail. | `PROXIES`, `getProxy`, `hasProxy`, `proxyIds` |
| `platform.ts` (223L) | OS abstraction: `PATH` split/merge, exe-name expansion per OS, `~`/`%VAR%` expansion, `userBinDirs` (covers ~/.local/bin, cargo, brew, python, npm, nvm, yarn, scoop), `commonSearchDirs`, drive enumeration, `currentPlatformContext`. | `splitPathEnv`, `exeNames`, `expandPath`, `userBinDirs`, `mergePathWithUserBins` |
| `scanner.ts` (252L) | Detection engine: PATH scan, well-known locations, system `which`, node/nvm dirs, deep drive scan. Never throws. | `scanAgent(def, ctx)`, `scanPathVariable`, `scanWellKnown`, `scanSystemCommand`, `scanDeep`, `verifyExplicitPath` |
| `config.ts` (422L) | Persistence: `ConfigStore` (JSON in user-data dir), defaults, profile validation/sanitize, corruption backup, custom agent/proxy CRUD, merge. | `ConfigStore`, `defaultConfig`, `defaultProfile`, `mergeConfig`, `validateProfile`, `activeProfile`, `defaultCustomAgent/Proxy`, `customAgentToDefinition` |
| `launcher.ts` (713L) | **Launch engine.** Pure plan builders: `buildProxyArgs`, `buildAgentEnv` (proxy env overlay), `composeChildEnv` (base env + augmented PATH + overlay), `buildEmbeddedLaunchCommand` (python-pty vs direct), `buildLaunchPlan`, `buildTerminalCommand` (cmd/osascript/emulator). Plus `ProcessManager` (injectable spawn/fetch/sleep/exists/env) that starts/stops proxy+agent, waits for readiness. | `ProcessManager`, `buildLaunchPlan`, `buildAgentEnv`, `composeChildEnv`, `buildTerminalCommand`, `splitArgs`, `quoteArg` |
| `proxy-manager.ts` (248L) | Per-agentId proxy lifecycle (`server`/`wrapper` modes) with ready-state polling and state machine `stopped→starting→up→stopping→error`. | `ProxyManager`, `ProxyRunState` |
| `proxy-install.ts` (343L) | **Compressor install catalog** — multi-source per platform (npm/pip/uv/pipx/brew/cargo/npx/docs), verified package names only. Derives uninstall/update from chosen option. `formatInstallOutcome` for user feedback. | `getProxyInstallOptions`, `pickPreferredInstallCommand`, `deriveUninstallCommand`, `deriveUpdateCommand`, `formatInstallOutcome`, `resolveInstallShell` |
| `agent-install.ts` (140L) | **Agent install catalog** — same pattern for the 27 agents. | `getAgentInstallOptions`, `pickPreferredAgentInstallCommand` |
| `port-allocator.ts` (202L) | Auto port assignment in range 8400–8999 (max 200 tries), port-in-use probing, `chooseLaunchPort` for launches. | `PortAllocator`, `chooseLaunchPort` |
| `launch-records.ts` (132L) | Launch history: `LaunchTracker` (records, mergeWorkflowOutput), `resolveTrackerId`. Powers Dashboard + Launches list. | `LaunchTracker`, `mergeWorkflowOutput` |
| `compatibility.ts` (88L) | Which compressors support which agents (matrix + status: compatible/install-required/unsupported). | `COMPATIBILITY`, `isCompatible`, `compatibleAgentIds`, `compatibleCompressorIds`, `detectionStatus` |
| `theme.ts` (18L) | Theme mode resolution (`system`/`dark`/`light`) → resolved dark/light. | `resolveTheme`, `isThemeMode` |
| `logger.ts` (64L) | Ring-buffer logger with subscription (drives Logs panel). | `Logger` |

### src/preload (context bridge — the only renderer→backend seam)

| File | Role |
|---|---|
| `index.ts` (133L) | Exposes `window.headroom`: 30+ invoke wrappers (listAgents, scanAll, scanAgent, detectHeadroom, listProxies, detectProxy, install/update/uninstall proxy+agent, config get/save, start/stop/launchEmbedded, runtimes, logs, dialogs, port check/kill, compatibility, custom agent/proxy, launches, writeStdin) + 4 event subscriptions (`onLog`, `onRuntime`, `onOutput`, `onTerminalData`). |

## Frontend

### src/renderer (vanilla TS, no framework — state in module scope, imperative render)

| File | Role |
|---|---|
| `index.html` | Shell with 5 view panes + sidebar + logs panel. CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src http://127.0.0.1:*` (iframe dashboard). |
| `app.ts` (1855L) | All UI logic. `init()` bootstraps; `switchTab()` manages 5 tabs: **agents** (`renderSidebar`, `renderDetail`, profiles, env editor, install options, launch bar), **compressors** (`renderCompressors`, create/select/install/update/remove, custom proxy form), **workflow** (xterm sessions: `renderWorkflowTabs`, `ensureWorkflowXterm`, `showWorkflowTerminal`, `restartWorkflowSession`, `addWorkflowSession`), **settings** (`renderSettings`, custom agents), **dashboard** (`renderDashboard`, iframe telemetry). Plus `launch()`, `launchWorkflow()`, `stop()`, `refreshRuntime()`, `renderLogs()`/`appendLogLine()` (Logs panel), `refreshHeadroomStatus()`, `schedulePortCheck()`, `killPort()`, `stripAnsi()`/`escapeHtml()`, modal helpers, `toast()`. |
| `styles.css` (566L) | Dark/light themes via `[data-theme]`, cards, grid, pills, xterm chrome. |
| `xterm.css` | Bundled xterm.js styles (copied to dist). |

## The IPC contract (src/shared/types.ts `IPC` const — single source of truth)

**Renderer → main (invoke):** `agents:list`, `scan:all`, `scan:agent`, `headroom:detect`, `proxies:list`, `proxy:detect`, `proxy:install`, `proxy:install-options`, `proxy:uninstall`, `proxy:update`, `agent:install`, `agent:install-options`, `config:get`, `config:save`, `launch:start`, `launch:stop`, `launch:embedded`, `runtime:all`, `logs:list`, `logs:clear`, `dialog:pick-executable`, `dialog:pick-directory`, `shell:open-path`, `shell:open-url`, `port:check`, `port:kill`, `compatibility:get`, `compatibility:agents`, `custom-agent:save`, `custom-agent:delete`, `custom-proxy:save`, `custom-proxy:delete`, `launches:list`, `process:input` (34 channels).

**Main → renderer (events):** `event:log`, `event:runtime`, `event:output`, `event:terminal-data` (raw PTY bytes for xterm).

**Key shared types:** `AgentDefinition`, `AgentProfile`, `AppConfig`, `ProxyDefinition`, `ProxyProfile`, `CustomAgent/Proxy`, `ScanResult` (+`ScanSource`), `AgentRuntime` (+`RunState`), `LaunchPlan`, `LaunchRecord`, `LogEntry`, `ThemeMode`, `PlatformName`, `LaunchStrategy`, `EnvStyle`, `InterfaceType`.

## Launch lifecycle (data flow)

1. User picks agent + compressor → `window.headroom.start({agentId, compressorId})` (or `launchEmbedded` for Workflow).
2. `ipc.ts` handler → core: `buildLaunchPlan` (port via `PortAllocator`/profile, proxy args via `buildProxyArgs`, env overlay via `buildAgentEnv` + `composeChildEnv`).
3. `ProcessManager`/`ProxyManager` spawns the compressor (`child_process.spawn`), polls `/livez`/`/healthz` via `fetch` until ready.
4. Agent spawn: CLI → new terminal window (`buildTerminalCommand`: `cmd /c start` / `osascript` / emulator); GUI → detached; Workflow → embedded PTY (python-pty or direct) with bytes routed to xterm via `event:terminal-data`, stdin via `process:input`.
5. Runtime state pushed to renderer via `event:runtime`; launch recorded in `LaunchTracker`.
6. Stop: proxy killed first (frees port), then agent; `Shutdown()` kills everything on quit.

## Test map (27 files, vitest + jsdom for renderer)

| Test file | Covers |
|---|---|
| `agents.test.ts`, `all-agents.test.ts` | agent registry, cross-platform well-known paths |
| `proxies.test.ts` | compressor registry + `buildProxyEnv` |
| `proxy-install.test.ts`, `install-scan-all.test.ts` | install catalogs (no fabricated names), install→scan flow |
| `platform.test.ts`, `cross-platform.test.ts`, `port-semantics.test.ts` | OS abstraction, all-OS sweeps |
| `scanner.test.ts` | detection (PATH/well-known/nvm/deep) |
| `config.test.ts` | ConfigStore, validation, corruption recovery |
| `launcher.test.ts`, `embedded-launch.test.ts`, `launch-integration.test.ts`, `process-manager-launchid.test.ts` | launch plans, ProcessManager, embedded PTY, PATH preservation |
| `proxy-manager.test.ts`, `multi-proxy-agents.test.ts` | proxy lifecycle, concurrent agents |
| `port-allocator.test.ts` | port assignment |
| `launch-tracker-routing.test.ts` | LaunchTracker records |
| `compatibility.test.ts`, `shared-types.test.ts` | compatibility matrix, shared types |
| `theme.test.ts`, `logger.test.ts` | theme, logger ring buffer |
| `ui-renderer.test.ts`, `renderer-app.test.ts`, `compressors-gui.test.ts` | renderer UI via jsdom |
| `workflow-terminal.test.ts`, `workflow-xterm-install.test.ts` | workflow xterm + install UX |
| `cross-platform.test.ts` | win32/darwin/linux sweeps |

## Scripts & tooling

| File | Purpose |
|---|---|
| `scripts/build.mjs` | esbuild: main (CJS/node), preload (CJS/node, electron external), renderer (IIFE/browser) → `dist/`; copies HTML/CSS/assets. |
| `scripts/e2e-launch.mjs` | CDP end-to-end lifecycle test against a live Electron (`--remote-debugging-port=9222`) using a fake agent binary. |
| `scripts/smoke.mjs` | CDP smoke: collects console errors + screenshot. |
| `scripts/fake-agent.cmd` | Fake agent for E2E (launch/exit detection). |
| `scripts/verify-issue3.ts` | Issue #3 verification script. |
| `scripts/run_pi.sh` | Dev helper: launch Pi coding agent through rtk + headroom. |
| `headroom_common.sh` | Shared headroom launch helper (dev tooling, points at career-studio-ai by default). |
| `build_and_run.sh` / `.bat` | One-click build+run per platform. |
| `vitest.config.ts` | node env; coverage: core+shared+renderer, thresholds 80/75/75/80; main+preload excluded. |
| `tsconfig.json` | ES2022 strict, bundler resolution, noEmit, includes tests. |

## Config persistence

JSON in the OS user-data dir: macOS `~/Library/Application Support/token-zero-studio/config.json`, Windows `%APPDATA%\token-zero-studio\`, Linux `~/.config/token-zero-studio/`. Loaded by main, stored via `ConfigStore`, never trusted raw (merged + sanitized).
