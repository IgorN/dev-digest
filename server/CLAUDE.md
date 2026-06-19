# server (`@devdigest/api`)

Fastify + Drizzle/Postgres on :3001. pnpm.

## Before answering
Search `server/docs/`, `server/INSIGHTS.md`, and `server/README.md` for the topic
before reading code — they're curated and may already answer it.

## Conventions (not obvious from code)
- DI via `src/platform/container.ts`: services depend on interfaces, constructed
  lazily; tests inject mocks via `ContainerOverrides`. Don't `new` adapters in
  routes — pull them off `container`.
- Secrets go through `container.secrets` only (never `process.env` directly); call
  `container.invalidateSecretCaches()` after a Settings change.
- Feature modules are registered **statically** in `src/modules/index.ts` — no
  filesystem autoload. New feature = new folder under `src/modules/` + one line
  there.
- repo-intel is reached only through `container.repoIntel.*` — never touch its
  pipeline directly.
- `@devdigest/shared` is **vendored** at `src/vendor/shared/` and mirrored in the
  client; edit both copies in lock-step.
- ESM: relative imports carry the `.js` extension.

## Do-not-touch (without coordination)
- `src/vendor/shared/` — vendored contracts; the client copy must stay in sync.
- `src/db/migrations/` — generated SQL. Schema change → `pnpm db:generate` →
  `pnpm db:migrate`. Migrations are NOT applied on boot. Don't hand-edit SQL.
- `server/package.json` — `git skip-worktree`; don't rely on uncommitted scripts.

## Use when
- Overview, commands, route/API map → `server/README.md`
- Indexer internals → `server/src/modules/repo-intel/README.md`
- Deep-dives → `server/docs/` · gotchas/findings → `server/INSIGHTS.md`
- Tests: unit `pnpm exec vitest run --exclude '**/*.it.test.ts'`; integration
  (Docker) `pnpm exec vitest run .it.test` — integration files MUST end `*.it.test.ts`.
