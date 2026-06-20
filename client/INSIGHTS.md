# Insights — client (`@devdigest/web`)

Non-obvious findings and gotchas for the client package. Add an entry whenever
something surprised you, so the next agent/session doesn't relearn it.
Append-only — see the `engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-06-19** — Two separate `formatCost` implementations (in `RunCostBadge` and the trace-drawer `helpers.ts`) drifted: the badge used `toExponential` for `< $0.001`, so the timeline showed an unreadable "$7.3e-4" while the trace tile showed "$0.0007". Fixed by extracting ONE `formatCost` to `src/lib/cost.ts` consumed by both. Lesson: a display formatter used in >1 place belongs in a shared module from the start. Evidence: `client/src/lib/cost.ts`.
- **2026-06-19** — A hover popover positioned `absolute` inside the PR-list table got clipped by the table card's `overflow: hidden`, and a `top: 100% + gap` offset made it close before you could reach it (the pointer crosses empty space → `onMouseLeave` fires). Fix: render the popover `position: fixed` anchored via `getBoundingClientRect` (escapes the `overflow:hidden` ancestor) + a ~160ms close delay that the popover's own `onMouseEnter` cancels, so the pointer can travel onto it and scroll. Evidence: `client/src/components/FindingsSummary/FindingsSummary.tsx`.

## Codebase Patterns

- **2026-06-19** — PR-list table columns are driven by THREE things that must stay aligned: `GRID` (CSS grid-template-columns) + `COLUMN_KEYS` in `app/repos/[repoId]/pulls/constants.ts`, and the matching `list.columns.<key>` in `messages/en/prReview.json`. Adding a column (e.g. `cost`) means updating all three or the header/cells misalign. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-19** — `@devdigest/shared` is a vendored copy that must mirror the server's; cost work added `cost_usd` to `RunSummary` + `PrMeta` in `client/src/vendor/shared/contracts/trace.ts` & `platform.ts` in lock-step with the server copy.
- **2026-06-19** — `ReviewRecord` (`contracts/review-api.ts`) carries no cost/token data — only `RunSummary` does. To show cost in a per-review accordion, thread the `RunSummary` by `run_id` from the parent: `FindingsTab` builds a `Map<run_id, RunSummary>` and passes it to `ReviewRunAccordion`. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`.
- **2026-06-19** — Trace-drawer Stats tiles render in `TraceBody.tsx` from `trace.stats` (`RunStats`). Adding a tile = (1) add the field to `RunStats` in both vendor copies, (2) a `<Stat>` in `TraceBody`, (3) a formatter in the drawer's `helpers.ts`, (4) an i18n key under `runs.json` → `trace.stat.*`. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`.
- **2026-06-19** — PR-page findings-by-severity filter is threaded top-down: `FindingsTab` counts findings across all runs + holds the active severity, renders `SeverityFilter` (reuses `@devdigest/ui` `SeverityBadge` chips), hides runs with no matching finding, and forwards `severityFilter` → `ReviewRunAccordion` → `FindingsPanel` → `visibleFindings(findings, hideLow, severity)`. Works unchanged for historical runs — `severity` is an existing required field on every finding (no migration). Evidence: `.../SeverityFilter/SeverityFilter.tsx`, `.../FindingsPanel/helpers.ts`.
- **2026-06-19** — Findings-by-severity icon-counts + hover popover are one shared component `@/components/FindingsSummary` (uses `SEV`/`CAT` from `@devdigest/ui`). Reused in TWO places: PR-list FINDINGS column (`PRRow`, fed by `PrMeta.findings_*` counts + `PrMeta.findings` preview) and the PR-detail timeline per-run (`RunHistory`, fed by `findingsByRunId` built in `FindingsTab` from the already-loaded review records — no server call). `@devdigest/ui` exports `SEV`/`CAT` value maps (severity/category → {c,bg,icon,label}). Evidence: `client/src/components/FindingsSummary/FindingsSummary.tsx`.

## Tool & Library Notes

## Recurring Errors & Fixes

- **2026-06-19** — Adding a required field to a vendored Zod contract breaks test fixtures that build the full type from a `Partial<>` helper: `TS2719: Two different types with this name exist… 'undefined' is not assignable`. Fix: add the new field (e.g. `cost_usd: null`) to the helper's base object. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx`.

## Session Notes

### 2026-06-19
- Added `RunCostBadge` (compact `$0.012` / full `$0.014 · 8.2K→1.3K` / tokens-cost `9,119 tok · $0.0013`) and surfaced cost in the PR-list COST column, run timeline, review accordion, AND the trace-drawer Stats COST tile; cost comes from existing tokens×price already on `RunSummary` (zero extra LLM calls).
- Tests: `RunCostBadge.test.tsx` covers all 3 variants + the load-bearing rule "no data → '—', never '$0.00'". Backend cost source (`PriceBook.estimate`, incl. unknown-model → null) is already covered by `server/test/price-book.test.ts`; the DB persist/return path is integration-only (Docker), not unit-covered.

## Open Questions
