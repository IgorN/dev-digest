# CLAUDE.md — DevDigest agent guide

Local-first AI PR reviewer. Course starter: Part-0 works end to end (import PR →
run agent review); each lesson (L01–L08) adds one feature. Check before assuming
something exists yet.

This file is a **map**, not documentation. Stack + commands + the few non-obvious
rules + where to look next. Per-package detail lives in each package's `CLAUDE.md`.

## Before answering
Search the relevant package's `docs/` and `INSIGHTS.md` (and `specs/` where it
exists) for what the user asks about FIRST — they're curated and may already
answer it — then read code.

## Session protocol (engineering-insights loop)
- **Start:** before touching a package, read its `INSIGHTS.md` and summarize the
  top 3 relevant points — this forces an active read and catches a silent load
  failure.
- **Before recording:** re-read that package's `INSIGHTS.md` and don't duplicate
  what's already there.
- **End of session:** run the `engineering-insights` skill (`/engineering-insights`).
  Record only substantial, file-grounded, non-duplicate findings; if nothing
  substantial came up, write nothing — but don't skip the check. Writes are
  strictly **append-only** (never overwrite an `INSIGHTS.md`).

## Stack

| Folder           | Package                    | Runtime                          | PM   |
|------------------|----------------------------|----------------------------------|------|
| `server/`        | `@devdigest/api`           | Fastify + Drizzle/Postgres :3001 | pnpm |
| `client/`        | `@devdigest/web`           | Next.js 15 / React 19 :3000      | pnpm |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine (no I/O)             | npm  |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e        | npm  |

No root `package.json`. Not a workspace — each package has its own
package.json/lockfile; cross-package code is shared as TypeScript source via
tsconfig path aliases.

## Commands

```sh
./scripts/dev.sh            # docker up → migrate → seed → :3001 + :3000
./scripts/dev.sh --db-only  # Postgres only

cd server && pnpm dev        # tsx watch :3001
pnpm db:generate             # drizzle-kit: gen migration from schema diff
pnpm db:migrate              # apply migrations (NOT auto on boot)
pnpm db:seed                 # idempotent demo data
pnpm typecheck               # tsc --noEmit

cd client && pnpm dev / build / typecheck / test
cd reviewer-core && npm test
```

**Tests:**
```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'  # unit (no Docker)
cd server && pnpm exec vitest run .it.test                     # integration (Docker)
cd client && pnpm test
```

## Gotchas (not obvious from code)
- **Migrations are NOT applied on boot.** Schema change → `pnpm db:generate` → `pnpm db:migrate`.
- **`reviewer-core/node_modules` must be installed** or the API crashes (`dev.sh` runs `npm ci`).
- **Integration tests must end in `*.it.test.ts`** — the unit lane excludes that glob.
- **`@devdigest/shared` is vendored** into `server/src/vendor/shared` AND `client/src/vendor/shared`;
  editing one does NOT update the other — keep both in sync deliberately.
- **`server/package.json` is `git skip-worktree`** — don't rely on uncommitted scripts.
- Secrets go through `container.secrets`, never `process.env`; call `container.invalidateSecretCaches()` after a Settings change.
- Feature modules are registered **statically** in `server/src/modules/index.ts` — no autoload.

## Do-not-touch (without coordination)
- `server/src/vendor/shared/` + `client/src/vendor/shared/` — vendored, kept in sync by hand.
- `server/src/db/migrations/` — generated SQL; regenerate, don't hand-edit.

## Use when
- Working inside a package → read that package's `CLAUDE.md`:
  `server/CLAUDE.md` · `client/CLAUDE.md` · `reviewer-core/CLAUDE.md` · `e2e/CLAUDE.md`
- Stack/commands/how-to-run detail → that package's `README.md`
- Gotchas & findings → that package's `INSIGHTS.md`
- How insights get captured → `.claude/skills/engineering-insights/SKILL.md`
