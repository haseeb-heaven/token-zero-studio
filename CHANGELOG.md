# Changelog

All notable changes to **Token Zero Studio** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
