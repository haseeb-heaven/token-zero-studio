# Headroom AI Launcher

A professional, cross-platform desktop GUI for running every AI coding agent
through the [Headroom](https://github.com) context-optimization proxy.

Headroom wraps AI coding agents (Claude Code, Codex, Cline, Cursor, Goose,
Grok, OpenCode, and more) to compress context and cut token spend. This app is a
thin, friendly wrapper: it lists the supported agents, finds them on your
system, gathers the configuration needed to run each one through Headroom, and
launches them with a single click.

![Dark theme screenshot](assets/main_ui.png)

---

## Features

- **All 18 supported agents** in one list — Claude Code, OpenAI Codex CLI, Cline,
  Continue, GitHub Copilot CLI, Cursor, Goose, Grok CLI, Grok Build, Kimi CLI,
  Oh My Pi, OpenClaude, OpenClaw, OpenCode, OpenHands, Mistral Vibe, ZCode, Aider.
- **Auto-detection** — scans `PATH` and well-known install locations; you can
  also browse to an executable or paste an explicit path.
- **Saved profiles** — per-agent, named configurations (path, port, mode,
  memory/learning/lossless/passthrough toggles, extra args, env overrides,
  working directory). Switch between them instantly.
- **Live logs** — filterable, auto-scrolling log panel for proxy and agent
  output.
- **Per-agent ports** — unique default ports so several agents run at once;
  live "available / in use" checks.
- **Dark / Light / System** themes synced with the OS.
- **Cross-platform** — Windows, macOS and Linux.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (for development)
- [Headroom](https://github.com) installed and on your `PATH`
  (`pip install headroom-ai`) — the launcher detects it automatically.
- One or more of the supported AI agents installed (e.g. `npm i -g @anthropic-ai/claude-code`,
  `curl -LsSf https://codex-cli.ai/install.sh | sh`, etc.).

## Quick start

```bash
git clone https://github.com/haseeb-heaven/headroom-agent.git
cd headroom-agent
npm install
npm run build     # bundles the Electron main, preload and renderer
npm start         # launches the app
```

### Development

```bash
npm run dev       # build (no watch) and launch Electron
npm test          # run the unit-test suite
npm run coverage  # run tests with a coverage report
```

## How it works

1. The launcher starts `headroom proxy --port <port>` with your chosen flags.
2. It waits for the proxy to answer (the first cold boot loads compression
   models and can take ~40 s; the timeout is configurable in **Settings**).
3. It launches the selected agent with `ANTHROPIC_BASE_URL` /
   `OPENAI_BASE_URL` pointing at the local proxy, so all of the agent's API
   traffic is optimized by Headroom.
4. For IDE-extension agents (e.g. Continue) that can't be launched directly, it
   starts the proxy and shows the manual configuration to paste in.

This mirrors exactly what the `run_*.cmd` / `run_*.sh` scripts in
`Dev_HeadRoom_Commnands` do, but with a UI and no manual editing.

## Project structure

```
src/
  core/        # pure, unit-tested business logic (agents, scanner, config, launcher, logger, theme)
  shared/      # shared TypeScript types and the IPC channel map
  main/        # Electron main process: window + IPC wiring
  preload/     # context-bridge API exposed to the renderer
  renderer/    # vanilla-TS UI (no framework bloat)
tests/         # vitest unit tests (328 tests)
scripts/       # build, smoke-test and end-to-end launch helpers
assets/        # logo and screenshots
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deeper dive into the design,
the launch lifecycle and the security model.

## Configuration

Settings are persisted as JSON in the user data folder:

- **Windows**: `%APPDATA%\headroom-ai-launcher\config.json`
- **macOS**: `~/Library/Application Support/headroom-ai-launcher/config.json`
- **Linux**: `~/.config/headroom-ai-launcher/config.json`

A corrupt file is automatically backed up as `config.json.corrupt` and
replaced with defaults.

## Testing

The project is developed test-first. The suite covers:

- the agent registry (all 18 agents, unique ports, valid metadata),
- per-agent env wiring, launch plans, terminal commands and scanning,
- the cross-platform scanner (PATH + well-known locations + explicit paths),
- config persistence, validation and corruption recovery,
- the process manager lifecycle (start / proxy-ready / stop / cleanup),
- theme resolution and config merging.

```bash
npm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, coding
conventions and how to add a new agent to the registry.

## License

MIT
