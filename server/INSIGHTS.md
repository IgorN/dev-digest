# Insights — server (`@devdigest/api`)

Non-obvious findings and gotchas for the server package. Add an entry whenever
something surprised you, so the next agent/session doesn't relearn it.
Append-only — see the `engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-06-19** — Adding a NEW required field to a persisted document contract breaks reading old rows: `run_traces.trace` is stored JSON, so making `RunStats.cost_usd` `.nullable()` (key required) throws in `RunTrace.parse` on traces written before the field existed. Use `.nullish()` for fields added to already-persisted contracts. Evidence: `src/vendor/shared/contracts/trace.ts`.

## Codebase Patterns

- **2026-06-19** — `@devdigest/shared` contracts are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field (e.g. `cost_usd`) means editing both in lock-step; the only intended diffs are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-19** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`src/modules/reviews/repository/run.repo.ts`) AND the interface wrapper (`src/modules/reviews/repository.ts`). Adding a field (e.g. `costUsd`) to one without the other fails typecheck.
- **2026-06-19** — PR-list per-PR cost is computed ON READ in `GET /repos/:id/pulls`, not denormalized: leftJoin `agent_runs` on the latest review's `run_id` and surface that run's `cost_usd` (null until reviewed). Evidence: `src/modules/pulls/routes.ts`.
- **2026-06-19** — `RunTrace.stats` is assembled in TWO spots in `run-executor.ts` — the success path (~`:265`) AND the error/fallback trace (~`:425`). A new stats field (e.g. `cost_usd`) must be set in both. Evidence: `src/modules/reviews/run-executor.ts`.
- **2026-06-19** — (supersedes the leftJoin-latest-run note above) PR-list COST is now the SUM of ALL of a PR's `agent_runs.cost_usd` — `sql\`sum(${agentRuns.costUsd})\`` grouped by `pr_id` — i.e. "total spend to review this PR", not the latest run's cost. Per-run cost still shows in the timeline/trace. Null (no priced run) → "—". Evidence: `src/modules/pulls/routes.ts`.

## Tool & Library Notes

- **2026-06-19** — New DB column flow: edit `db/schema/*.ts` → `pnpm db:generate` (drizzle-kit emits `00NN_*.sql`) → `pnpm db:migrate` (NOT applied on boot). If Docker is down and you hand-author the SQL, you MUST also add the matching entry to `db/migrations/meta/_journal.json` or drizzle won't track it. Evidence: `src/db/migrations/0010_add_cost_usd_to_agent_runs.sql`, `meta/_journal.json`.

## Recurring Errors & Fixes

## Session Notes

### 2026-06-19
- Re-introduced per-run cost (USD) end-to-end (reverses the earlier removal in `d45ab0d`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced via `RunSummary`/`PrMeta`.
- Decision: PR-list COST = the latest review's run cost via leftJoin on `reviews.run_id` (not a batch sum); historical/unpriced runs → null → "—".
- Resolution (supersedes the Open Question below): the hand-authored migration was discarded and regenerated with `pnpm db:generate` (→ `0010_clumsy_mulholland_black.sql` + `meta/0010_snapshot.json`) then applied with `pnpm db:migrate`. Column verified present. Lesson: NEVER hand-author a drizzle migration — without the matching `meta/00NN_snapshot.json`, the next `db:generate` re-emits the same column; let drizzle generate it (it doesn't need a DB connection, only `migrate` does).

## Open Questions

- **2026-06-19** — Migration 0010 (`cost_usd`) was hand-authored while Docker was down and has NOT been applied yet — run `cd server && pnpm db:migrate` before relying on cost data, and verify drizzle accepts the manual `_journal.json` entry.
