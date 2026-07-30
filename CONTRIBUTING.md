# Contributing

Thanks for helping make Token Zero Studio better.

## Development setup

```bash
npm install
npm run build     # build the Electron bundles
npm start         # launch the app
```

## Workflow

1. Create a feature branch from `develop`.
2. Write tests first (TDD) in `tests/` using [vitest](https://vitest.dev).
3. Implement in `src/core/` (pure logic) and/or `src/main/`, `src/renderer/`.
4. Run the full suite:
   ```bash
   npm test
   ```
5. Keep TypeScript clean:
   ```bash
   npx tsc --noEmit -p tsconfig.json
   ```
6. Rebuild before running the app:
   ```bash
   npm run build
   ```

## Adding a new agent

1. Add an entry to the `AGENTS` array in `src/core/agents.ts` with:
   - `id` (matches `headroom wrap <id>`),
   - `name`, `vendor`, `description`,
   - `interfaceType` (`cli` | `gui` | `ide-extension`),
   - `launchStrategy` (`env` for auto-launch, `instructions` for IDE extensions),
   - `executables` (binary names searched on `PATH`),
   - `wellKnownPaths` per platform,
   - `envStyle` (`anthropic` | `openai` | `both` | `none`),
   - `defaultPort` (unique, 8700–8899),
   - `configFileHint`, `accent`, `homepage`.
2. Add a matching entry to the `FACTS` table in `tests/all-agents.test.ts`.
3. Run `npm test` — the per-agent test suite validates the new agent.

## Code style

- TypeScript strict mode; no `any`.
- Core modules are pure and injectable (no direct Node/Electron imports).
- Renderer: vanilla TS, imperative DOM, no frameworks.
- Commit messages: conventional commits (`feat:`, `fix:`, `test:`, `docs:`).

## Branches

- `main` — stable, release-ready code.
- `develop` — integration branch for features.
