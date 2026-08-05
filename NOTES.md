# NOTES.md — the user's world (TokenZero Studio)

## Project
- **Repo:** token-zero-studio (Electron + TypeScript + esbuild + vitest), branch `develop`.
- **App:** "TokenZero - Studio" — GUI launcher that routes AI coding agents (Claude Code, Codex, Cline, …) through token-compression proxies (Headroom, PxPipe, RTK, …).
- **Verify:** `npm run test` (2177+ tests), `npm run typecheck`, `npm run build`.
- **Commands:** `npm run dev` (build + electron), `node scripts/build.mjs` (bundle only).

## Canonical vocabulary
- **Agents** = coding CLIs (claude, codex, cline, gemini, grok, kimi, …) launched with proxy env vars.
- **Compressors** = token-optimization proxies (headroom, pxpipe, rtk, llmlingua, tokenshift, caveman, leanctx, supercompress, selective-ctx, squeez, omni-route, graphify, ponytail). User also calls them "proxies".
- **Workflow** = in-app embedded terminal (xterm + PTY) where an agent runs; sessions share a launch pool.
- **Detect/Scan** = binary discovery (PATH + user bins + nvm + well-known paths). **Install** = multi-option CLI install (uv/pip/pipx/npm/brew/cargo/npx). **Update/Remove** = derived from the chosen install option.
- **Conductor** = REMOVED landing tab (user: "remove conductor tab"); Agents is now the default tab.

## User environment
- macOS (darwin), home `/Users/haseeb-mir`. npm global prefix = `~/.local` (so binaries land in `~/.local/bin` — NOT `/usr/local/bin`).
- Installed: pxpipe (binary name `pxpipe`, NOT `pxpipe-proxy` — registry must check both), headroom (uv tool), cline (nvm node prefix), cursor-agent.
- nvm-managed node (`~/.nvm/versions/node/v22.x/bin`) — scanner must enumerate nvm dirs.
- Sibling session (Telegram gateway) also commits to this repo — check `git log`/`git status` before and after work to avoid clobbering; `hermes send --to telegram` delivers notifications.

## Known pitfalls discovered
- Fabricated package names broke installs: verified against npm/PyPI/brew before trusting a command (pxpipe→pxpipe-proxy, lean-ctx→leanctx, supercompress is PyPI-only, tokenshift/omni-route have NO real package → docs-only option).
- Electron's stripped PATH breaks child agents: always `composeChildEnv` (merge user bins into PATH) when spawning.
- npx options are ephemeral — never claim "installed" (exit 0 but no binary on PATH).
- Embedded PTY bytes must go to the terminal only, never the structured LOGS panel (ANSI flood / autoscroll).
- Dashboard iframe needs `frame-src http://127.0.0.1:*` in the CSP or it's blocked.
