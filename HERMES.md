# HERMES.md — how Hermes works in token-zero-studio

This file is the working agreement for Hermes (and any agent) operating in this
repo. Read `CODEMAP.md` for the full file-by-file map, `ARCHITECTURE.md` for
design intent, and `NOTES.md` for the user's world. This file is tracked; local
agent notes and plans live in `.hermes/` (gitignored).

## What this app is

TokenZero - Studio: a cross-platform (darwin/linux/win32) Electron GUI that
detects pre-installed AI coding agents, binds a token-compression proxy
(compressor) to the agent's API env (`ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`),
and launches the agent — in an external terminal, detached, or in the embedded
Workflow terminal (xterm.js + PTY). NOT a router; no central server.

## Non-negotiables

- **Branch:** `develop`. Never commit to `main` unless told.
- **Verify before claiming done:** `npm run test` AND `npm run typecheck` AND
  `npm run build` — full pipeline, not just the changed file.
- **Coverage gate:** user demands >80% statements/lines including
  `src/renderer` (vitest thresholds 80/75/75/80). Check with `npm run coverage`.
  `src/main` + `src/preload` are excluded (not exercisable in vitest).
- **TDD:** write the failing vitest test first (RED), implement, then GREEN.
  See `.hermes/plans/` for the established pattern (test-first tasks).
- **Bug spec = pasted LOGS panel output.** The app's Logs panel is the source
  of truth for what actually happened; treat pasted logs as the requirements.
- **Commit style:** conventional, scoped — `feat(core):`, `fix(gui):`,
  `fix(main):`, `test:`, `chore:`. One topic per commit. See `git log`.
- **Sibling session:** another Hermes (Telegram gateway) commits to this repo
  concurrently. Run `git status`/`git log` before AND after editing; never
  force-push; rebase-friendly linear history.

## Canonical vocabulary (use it in code, commits, docs)

- **Agents** = the 27 coding CLIs/editors in `src/core/agents.ts`.
- **Compressors** = the 13 token-optimization proxies in
  `src/core/proxies/registry.ts` (headroom, pxpipe, rtk, llmlingua, tokenshift,
  caveman, leanctx, supercompress, selective-ctx, squeez, omni-route, graphify,
  ponytail). User also calls them "proxies".
- **Workflow** = in-app embedded xterm terminal; sessions share a launch pool.
- **Detect/Scan** = binary discovery. **Install/Update/Remove** = catalog-driven
  CLI operations (`proxy-install.ts` / `agent-install.ts`).
- **Dashboard** = proxy telemetry iframe view (`frame-src http://127.0.0.1:*`).

## Known pitfalls (verified, do not repeat)

1. **Never fabricate package names/commands.** Every install catalog entry must
   reference a real package: probe `registry.npmjs.org/<pkg>`,
   `pypi.org/pypi/<pkg>/json`, `formulae.brew.sh/api/formula/<name>.json`
   (expect HTTP 200) before trusting it. Tokenshift/omni-route have no real
   package → `docs`-style option only.
2. **Electron strips PATH for children.** Always merge user bins into child env
   via `composeChildEnv()` (launcher.ts) when spawning agents — a node-shim
   agent (codex) dies instantly without PATH.
3. **npx installs are ephemeral** — exit 0 but no binary on PATH. Never claim
   "installed" for npx-only options.
4. **PTY bytes go to the terminal ONLY**, never to the structured LOGS panel
   (ANSI flood / autoscroll breakage).
5. **Dashboard iframe** needs `frame-src http://127.0.0.1:*` in the renderer CSP
   or it renders blank.
6. **User env quirks:** npm global prefix `~/.local` (binaries in
   `~/.local/bin`, NOT `/usr/local/bin`); nvm node prefixes must be enumerated
   in the scanner; pxpipe binary is `pxpipe` (not `pxpipe-proxy`); headroom
   installed via `uv tool`.
7. **Repo lives in ~/Documents** (iCloud Desktop&Documents). Check `ls -laO`
   for the dataless flag before reading; files can be evicted placeholders.
   Prefer cloning/working copies in `~/Code`.

## Quick commands

```bash
npm test            # vitest run (all)
npx vitest run tests/<file>.test.ts   # one file
npm run coverage    # v8 coverage with 80/75/75/80 thresholds
npm run typecheck   # tsc --noEmit
npm run build       # esbuild bundles into dist/ (main, preload, renderer)
npm start           # launch Electron
npm run dev         # build + launch
```

## Workflow for a change

1. `git status` / `git log --oneline -5` — sync with the sibling session.
2. Read the relevant part of `CODEMAP.md`; load the owning module.
3. Write failing test → confirm RED → implement → GREEN.
4. `npm run test && npm run typecheck && npm run build` (coverage check too
   when touching core/renderer).
5. Commit with a scoped conventional message; push to `develop`.

## Docs map

- `CODEMAP.md` — full backend/frontend file map, IPC channels, test map.
- `ARCHITECTURE.md` — layers and launch lifecycle.
- `NOTES.md` — user environment, vocabulary, pitfalls (authoritative on quirks).
- `AGENTS.md` + `docs/agents/` — issue tracker (gh CLI), triage labels,
  single-context domain layout. Root `CONTEXT.md` + `docs/adr/` are planned but
  not yet created — HERMES.md/CODEMAP.md currently serve that role.
