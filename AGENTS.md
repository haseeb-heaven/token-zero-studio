# AGENTS.md

Guidance for agents working in this repository.

## Read first (mandatory before any work in this repo)

- `HERMES.md` — the working agreement: verify pipeline (`npm run test` + `npm run typecheck` + `npm run build`), coverage gate (80/75/75/80 incl. renderer), TDD pattern, commit style, canonical vocabulary, and verified pitfalls.
- `CODEMAP.md` — the full backend/frontend file map: 27 agents, 13 compressors, the 34-channel IPC contract, every core module's job, launch lifecycle, and the test map.

These two files are the authoritative orientation for this codebase. `.hermes/` (gitignored) holds the agent's local notes and plans.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for this repo (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage labels, each label equal to its role name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus decisions in `docs/adr/`. See `docs/agents/domain.md`.
