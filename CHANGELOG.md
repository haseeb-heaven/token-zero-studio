# Changelog

All notable changes to **Token Zero Studio** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Compressor management** in the Compressors tab: per-compressor install (multi-option),
  update, and remove via IPC (`proxy:install` / `proxy:update` / `proxy:uninstall`), plus
  binary-path save and set-as-default actions.
- **Workflow terminal (TTY) mode setting** — `auto` / `python-pty` / `direct` transports
  for embedded agent sessions, persisted in the app config.
- **Install→scan test matrix** (`tests/install-scan-all.test.ts`): every agent and every
  compressor on all three platforms verifies install options exist, durable-first ordering,
  Remove/Update command derivation, and that post-install scans resolve the binary.
- **Renderer integration tests** (`tests/renderer-app.test.ts`): boots the real `index.html`
  + `app.ts` in jsdom with a stubbed preload API and exercises every tab, the launch/stop
  lifecycle, workflow sessions, context menus, modals, settings, env editor and dashboards.
- **Port-semantics tests** (`tests/port-semantics.test.ts`): server compressors bind the
  agent's resolved port; wrapper compressors (RTK/Caveman/Ponytail) correctly open no port.
- **Compatibility tests** (`tests/compatibility.test.ts`) and IPC channel contract tests
  (`tests/shared-types.test.ts`).
- Coverage thresholds raised to 90% statements/functions/lines with the v8 provider
  (branch floor 70% — the xterm PTY bridge is not exercisable under jsdom).
- `CODEMAP.md`, `HERMES.md` and Playwright E2E tooling for scripted GUI walks.

### Fixed
- **Launch used the wrong compressor**: the Launch button now forwards the compressor
  selected in the launch bar to the backend and shows the real compressor name + port in
  the status line (was hardcoded to "Headroom").
- **pxpipe detection**: registry checks both `pxpipe-proxy` and `pxpipe` names, so the
  binary installed by `npm i -g pxpipe-proxy` (shipped as `pxpipe`) is now found.
- **pxpipe startup**: it is env-configured (PORT/HOST), so `--port` flags were rejected;
  proxies now spawn with the real environment plus `buildStartEnv` (also fixed missing
  characters in embedded PTY output caused by an empty process env).
- **Grok CLI install**: `npm i -g grok` pulled an unrelated broken package (`soynode2`
  E404); the catalog now installs `grok-cli`, which ships the `grok` binary.
- **Dead workflow header buttons**: ✏️ Rename / 🔄 Restart / ✕ Close are now wired to the
  same actions as the right-click context menu.
- **Dashboard iframe CSP**: `frame-src` added so the embedded proxy dashboard loads.
- **Conductor tab removed** — Agents is the default landing view.
- Removed 129 lines of dead `_openSettings` modal code (superseded by the Settings tab).

### Security
- Renderer runs with `contextIsolation` enabled, `nodeIntegration` disabled and a
  sandboxed preload bridge — no Node APIs are exposed to the UI.
- Configuration is validated before persistence; corrupt config files are backed
  up as `config.json.corrupt` and replaced with defaults.

## [1.0.0] - 2026-07-30

### Added
- Initial public release of Token Zero Studio.
- Cross-platform (Windows, macOS, Linux) Electron + TypeScript desktop application.
- Registry of all 18 AI coding agents supported by Headroom (`headroom wrap`):
  Claude Code, OpenAI Codex CLI, Cline, Continue, GitHub Copilot CLI, Cursor,
  Goose, Grok CLI, Grok Build, Kimi CLI, Oh My Pi, OpenClaude, OpenClaw,
  OpenCode, OpenHands, Mistral Vibe, ZCode and Aider.
- Automatic system scanning for each agent via `PATH` and well-known install
  locations, with an explicit-path override (browse button) per agent.
- Per-agent **configuration profiles** (named, saved) — path, proxy port,
  optimization mode, memory/learning/lossless/passthrough toggles, extra proxy
  and agent arguments, environment overrides and working directory.
- Live **logs panel** (filterable by level, auto-scroll, clearable) capturing
  Headroom proxy and agent process output.
- **Dark / Light / System** theme with OS-level sync via `nativeTheme`.
- Settings modal for the Headroom binary path (browse/detect) and the proxy
  startup timeout (tuned to 60 s for cold ML-model boot).
- Port-availability check before launching an agent.
- Instructions card for IDE-extension agents (e.g. Continue) that need manual
  configuration pointing at the local proxy.

### Security
- Renderer runs with `contextIsolation` enabled, `nodeIntegration` disabled and a
  sandboxed preload bridge — no Node APIs are exposed to the UI.
- Configuration is validated before persistence; corrupt config files are backed
  up as `config.json.corrupt` and replaced with defaults.

## [1.0.0] - 2026-07-30

### Added
- First stable release. See [Unreleased](#unreleased) above for the feature set.
