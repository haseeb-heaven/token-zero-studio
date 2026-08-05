# Domain docs

This repo uses a **single-context** layout.

## Layout

- `CONTEXT.md` at the repo root holds the current understanding of the system and its domain.
- Architecture Decision Records (ADRs) live in `docs/adr/`.

## Consumer rules

- Read `CONTEXT.md` before significant work so it aligns with the documented domain model and vocabulary.
- Use the Ubiquitous Language from `CONTEXT.md` in code, commits, and docs.
- Record important architectural decisions as ADRs in `docs/adr/` (`<NNN>-<slug>.md`).
- Treat `CONTEXT.md` as the source of truth for domain understanding; flag conflicts to a human.
