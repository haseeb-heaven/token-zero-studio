# Architecture

Token Zero Studio is an Electron application built around a **pure,
unit-tested core** with thin platform layers on top. The core contains no
Electron or Node imports, so it can be tested in isolation and reused outside
the renderer.

## Layers

```
renderer (vanilla TS + CSS)   ←→  preload (context-bridge)  ←→  main (Electron)
                                      ↑
                                      │ IPC (typed channel map)
                                      ↓
core (pure logic)  ←→  shared types
```

### `src/shared/types.ts`
All shared types and the `IPC` channel map. Both the preload bridge and the
main-process handlers import from here, so channel names can never drift.

### `src/core/*` — pure, framework-free logic
| Module            | Responsibility |
|-------------------|----------------|
| `agents.ts`       | Registry of all 18 supported agents with cross-platform metadata (executables, well-known paths, env style, default port). |
| `proxies/`        | Registry of token-optimisation proxies (`Headroom`, `PxPipe`, `RTK`, `Custom`) with start flags and env styles. |
| `proxy-manager.ts`| Owns lifecycle of server and wrapper mode proxies per agentId with ready-state polling. |
| `platform.ts`     | `PATH` splitting, executable-name expansion per OS, `~`/`%VAR%` expansion, path joining, comparison normalisation. |
| `scanner.ts`      | Detects agents and proxies on `PATH`, in well-known locations, or at explicit paths. Never throws. |
| `config.ts`       | `ConfigStore` (JSON persistence), profile validation, corruption recovery, config merging. |
| `launcher.ts`     | Pure plan builders (`buildProxyArgs`, `buildAgentEnv`, `buildLaunchPlan`, `buildTerminalCommand`) + `ProcessManager` (injectable spawn/fetch/sleep). |
| `logger.ts`       | Ring-buffer logger with subscription. |
| `theme.ts`        | Theme-mode resolution (`system`/`dark`/`light`) and OS sync. |

These modules depend only on `shared/types` and on each other — never on
Electron or Node — which is why they have 328 unit tests.

### `src/main/*` — Electron main process
- `index.ts` loads the persisted config, sets `nativeTheme.themeSource`,
  creates the window (themed background colour) and registers IPC handlers.
- `ipc.ts` wires every IPC channel to the core modules, using real Node
  `child_process.spawn`, `net` (port checks) and `fetch` (proxy readiness).

### `src/preload/index.ts` — context-bridge
Exposes a typed `window.headroom` API. The renderer never touches Electron
directly.

### `src/renderer/*` — UI
Vanilla TypeScript (no framework) for a fast, dependency-light build. State is
held in module scope and rendered imperatively.

## Launch lifecycle

1. **Validate** — the agent executable is resolved (explicit path → scan hit);
   the chosen port is checked for availability.
2. **Start proxy** — `headroom proxy --port <port> --mode <mode> [--memory]
   [--learn] ...` is spawned.
3. **Wait for readiness** — `waitForProxyReady` polls `/livez` and `/healthz`
   until any HTTP response arrives or the timeout elapses.
4. **Launch agent** —
   - CLI agents open in a **new terminal window** (`cmd /c start` on Windows,
     `osascript` on macOS, a terminal emulator on Linux) so interactive TUIs
     work.
   - GUI agents (Cursor, ZCode) are spawned detached directly.
   - IDE-extension agents (Continue) leave the proxy running and show manual
     configuration instructions.
5. **Stop** — the agent and proxy are killed; the proxy is killed first so a
   re-launch can reuse the port.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes only the typed `window.headroom` surface.
- Configuration is validated before persistence; corrupt files are backed up.
- The renderer CSP allows only `'self'` for scripts and styles.

## Build

`scripts/build.mjs` bundles three targets with esbuild:

| Target    | Format | Platform |
|-----------|--------|----------|
| `main`    | CJS    | node     |
| `preload` | CJS    | node     |
| `renderer`| IIFE   | browser  |

Static files (HTML, CSS, logo) are copied into `dist/`.
