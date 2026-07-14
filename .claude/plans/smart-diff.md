# Development Plan: Smart Diff

## Goal
Classify every file in a PR's diff by risk role — `core` (business logic) / `wiring` (config, index files) / `boilerplate` (lock files, dist, snapshots) — using a deterministic, constants-driven path/pattern function, deterministically compose that with already-computed review findings (zero new LLM calls), and render it client-side as risk-grouped sections with boilerplate collapsed by default and clickable "N findings" badges that jump to the finding's line.

## Affected surfaces
- `server/` — new `smart-diff` module (`constants.ts`, `classify.ts`, `service.ts`, `routes.ts`), one registration line in `modules/index.ts`. No other server module is edited.
- `client/` — new `useSmartDiff` hook, new `SmartDiffViewer` component, `DiffTab` wiring, backward-compatible extensions to `FileCard`/`CodeLine`, i18n additions, `lib/types.ts` re-export additions.
- `reviewer-core/` — **not touched.** Confirmed by direct read: its whole charter (`reviewer-core/CLAUDE.md`) is "No I/O... takes inputs and returns a result" for the LLM review engine (prompt assembly, grounding gate, finding reduction). Smart Diff never calls an LLM and never touches review generation — it's generic PR-diff tooling, which the codebase's own module-registry comment (`server/src/modules/index.ts:23-25`) already files under a plain `modules/` folder ("intent/smart-diff"), not under the review engine.
- `e2e/` — no task assigned to `implementer`/`test-writer` (no dedicated pipeline agent for this surface). The acceptance criteria's demo + PR are inherently orchestrator/human work against the running stack — see Tasks/Risks.

## Relevant existing insights
- `server/INSIGHTS.md`: "PR-list FINDINGS column data is computed on read in `GET /repos/:id/pulls`, unioning the LATEST review PER AGENT... Dismissed findings are excluded... dedup logic is the pure, unit-tested `latestReviewsPerAgent(reviewsNewestFirst)` in `status.ts`." — this is reused directly for Smart Diff's own "last review" resolution (Design decision E), not reinvented.
- `server/INSIGHTS.md`: "The Skills feature shipped MOST of its plumbing in the Part-0 starter BEFORE the lesson... Lesson: grep the schema/contracts before assuming a feature needs new tables." — the same discipline led me to check for (and rule out) a `smart_diff` table, and independently surfaced evidence that `PrBrief` deliberately excludes `smart_diff` (see Confirmed already-built).
- `server/INSIGHTS.md`: "`@devdigest/shared` contracts are vendored as TWO hand-maintained copies... Adding a field means editing both in lock-step." — not directly exercised (this feature needs zero contract changes), but it's why both `brief.ts` copies were diffed before relying on them (confirmed identical).
- `client/INSIGHTS.md`: "PR-list table columns are driven by THREE things that must stay aligned..." — the same "N things must stay in sync" instinct led to checking whether `DiffTab`'s "Files changed · N files" / the tab-bar's file count would need to move in lock-step with the new grouped view. Confirmed non-issue: both already source from `PrDetail.files_count` (`PrDetailHeader.tsx:118`), untouched by grouping.
- `client/INSIGHTS.md`: "Findings-by-severity icon-counts + hover popover are one shared component `@/components/FindingsSummary`..." — a considered-and-rejected alternative for the new "N findings" badge: `FindingsSummary` does severity-broken-down counts with a hover popover, heavier than this feature needs (a plain count + click-to-navigate); flagged so the frontend implementer doesn't feel obligated to reuse it wholesale.
- `client/INSIGHTS.md`: "A hover popover positioned `absolute`... got clipped..." — relevant only if the frontend implementer chooses a hover-preview affordance; the literal requirement is click-only.
- `reviewer-core/INSIGHTS.md`: none relevant found.

## Confirmed already-built (do not re-implement)
Verified directly by reading the code:
- `SmartDiffRole`/`SmartDiffFile`/`SmartDiffGroup`/`ProposedSplit`/`SmartDiff` zod contracts — `server/src/vendor/shared/contracts/brief.ts:80-113`. Both vendored copies (`server/` and `client/`) diffed directly — byte-identical, including this block. Nothing to reconcile.
- `SmartDiffResponse = SmartDiff` re-export, ready for the route's return type — `review-api.ts:63-65`.
- `server/test/contracts.test.ts:107-118` already parses a `SmartDiff` fixture (shape-only, not a route test).
- `PrFile` (`platform.ts:185-191`, `{path, additions, deletions, patch}`) is exactly what `ReviewRepository.getPrFiles(prId)` returns (`reviews/repository.ts:38-40` → `reviews/repository/pull.repo.ts:29-34`) — the SAME rows `diff-loader.ts`'s fallback path already reads from the `pr_files` table. No patch text is needed for Smart Diff (`SmartDiffFile` has no patch field).
- `latestReviewsPerAgent`/`rollupSeverities` — pure, already-unit-tested (`server/test/pulls-status.test.ts`) in `server/src/modules/pulls/status.ts:23-52`, already exercised end-to-end by `server/test/pulls-findings-rollup.it.test.ts`.
- `ReviewRepository.reviewsForPull(prId)` (`reviews/repository.ts:63-65` → `reviews/repository/review.repo.ts:58-74`) returns **every** review for a PR (any `kind`), newest-first, each already paired with its own findings — no second query/join needed to attach findings, unlike the PR-list route.
- Cross-module pure-function/repository imports are an established pattern: `intent/service.ts:4-8` already imports `../reviews/repository.js`, `../reviews/run-executor.js` (for the `Logger` type), and `../reviews/diff-loader.js`. `smart-diff/service.ts` importing `../reviews/repository.js` and `../pulls/status.js` is the identical class of cross-module import.
- Module-registration pattern: one import + one line in `server/src/modules/index.ts` (`intent` at lines 12 and 38 is the direct precedent).
- `NotFoundError`/`getContext`/`IdParams` workspace-scoping pattern — precedented by `IntentService.get` (`intent/service.ts:30-34`).
- Client hook precedent: `useIntent(prId)` (`client/src/lib/hooks/intent.ts:15-21`) is a byte-for-byte template for `useSmartDiff(prId)` — plain `useQuery`, `enabled: !!prId`, no mutation.
- Client component/i18n co-location precedent: `IntentCard` confirms `Card`/`SectionLabel`/`EmptyState`/`Skeleton` (`@devdigest/ui`) usage and the "hook imported by direct path, not via the `hooks/` barrel" convention (`client/src/lib/hooks/index.ts` does not re-export `intent.ts`) — same pattern applies to `smart-diff.ts`.
- **New finding**: `client/messages/en/prReview.json:53-62` already has a fully-built, currently **unconsumed** `smartDiff` i18n block: `coreLabel`/`wiringLabel`/`boilerplateLabel`/`largeTitle`/`largeBody`/`filesCount`/`findingLines`/`groupedByRole` — including copy mapping directly onto `split_suggestion`. `prReview` is also the namespace every other PR-review component already uses. This resolves the i18n placement question definitively — see Design decision I.
- **New finding**: `PrBrief` (`brief.ts:115-122`, `= {intent, blast, risks, history}`) deliberately **excludes** `smart_diff`, despite `SmartDiff` being defined in the very same file — direct evidence Smart Diff was always meant to be computed live/on-read, not cached like the other `PrBrief` building blocks — see Design decision C.
- **New finding**: `CodeLine`/`FileCard` (`client/src/components/diff-viewer/`) are used in exactly two places in the whole client: `DiffTab.tsx` and `client/src/test/smoke.test.tsx`. Safe to extend with new optional props — but they currently have **zero** per-line DOM identity and **zero** externally-controlled open state. This is the plan's single biggest net-new client-engineering surface — see Design decision H.
- **New finding**: `GET /pulls/:id` (`pulls/routes.ts:241-333`) has no extracted "get PrDetail" service function — its GitHub-refresh-or-local-fallback logic lives inline in the route closure. Smart Diff's route must not try to call or duplicate it — see Design decision D.

## Gaps confirmed by direct read (this plan's net-new work)
1. `server/src/modules/smart-diff/` does not exist.
2. `server/src/modules/index.ts` has no `smartDiff` entry.
3. No file-classification code (`classifyFile` or equivalent) exists anywhere in the server.
4. `client/src/lib/hooks/smart-diff.ts` does not exist.
5. `client/src/lib/types.ts:35` re-exports only `SmartDiff` from `@devdigest/shared` — not `SmartDiffFile`/`SmartDiffGroup`/`SmartDiffRole`/`ProposedSplit`.
6. `DiffTab.tsx` (65 lines) renders only the flat `DiffViewer`; no `useSmartDiff` call, no grouping, no toggle.
7. `FileCard`/`CodeLine` have no findings-badge affordance, no controlled/forced-open capability, no per-line DOM anchor.
8. No test file anywhere (server or client) references Smart Diff beyond the one shape-only fixture in `server/test/contracts.test.ts`.

## Design decisions baked into this plan (resolved, not open questions)

**A. Scope boundary: no AI pseudocode summaries.** `SmartDiffFile.pseudocode_summary` stays `null`/unset for every file, in every code path. The pasted product screenshot's "🪄 summary" / "What this does:" blurbs are visual/layout inspiration only (grouped sections, collapsed boilerplate, badge styling), not a scope addition — generating them would require a new LLM call, directly contradicting the hard "no new model call" acceptance criterion. `pseudocode_summary` is `.nullish()` in the contract specifically so this feature can leave it unset.

**B. No `repo-intel` dependency.** `classifyFile` is pure path/pattern matching, nothing else. `repo-intel/types.ts:5-7`'s doc comment lists "smart-diff" among the facade's hypothetical future consumers, but this lesson's literal spec is explicitly "by path/pattern" — reaching into `repo-intel` would add an unnecessary dependency for zero benefit, and would silently degrade for any repo that hasn't been cloned+indexed. Rejected.

**C. No new DB table/migration.** `PrBrief` already composes the cacheable, LLM-derived building blocks and conspicuously excludes `smart_diff`. Smart Diff costs nothing to (re)compute — no LLM, cheap DB reads only — so a cache table would only add staleness risk for zero benefit. `GET /pulls/:id/smart-diff` recomputes on every call.

**D. File source: read persisted `pr_files`, don't re-fetch GitHub.** The route reads `ReviewRepository.getPrFiles(prId)` — the same method `diff-loader.ts`'s fallback path already uses — rather than duplicating `pulls/routes.ts`'s GitHub-refresh-and-persist dance inline. By the time a user opens the Files-changed tab, `GET /pulls/:id` has already run for the page and refreshed `pr_files` when GitHub was reachable; Smart Diff just reads what's there.

**E. Findings resolution ("last review").** Reuse `latestReviewsPerAgent` over `ReviewRepository.reviewsForPull(prId)`'s rows, **filtered to `kind === 'review'` before the dedup** (mirroring `pulls/routes.ts:143`'s own SQL-level filter — filtering after dedup would let a newer, finding-less `'summary'` row for an agent incorrectly supersede an older `'review'` row's real findings), then drop dismissed findings.

**F. `finding_lines` shape.** One entry per **surviving** finding = its `start_line` — not the `[start_line, end_line]` range, not deduped. Required for the "N findings" badge's `finding_lines.length` to equal the true finding count. A finding whose `file` doesn't match any current `PrFile.path` (stale/renamed) is simply not attached anywhere — dropped, not an error.

**G. `split_suggestion.total_lines` excludes boilerplate.** Counting a multi-thousand-line lockfile diff toward "is this PR too big" would defeat the feature's own purpose. `total_lines` = sum of `(additions + deletions)` over `core` + `wiring` files only; `too_big = total_lines > SMART_DIFF_TOO_BIG_LINES` (a new named constant in `constants.ts`, recommended starting value 400, aligned with the client's existing "Large" PR-size bucket `SIZE_MEDIUM_MAX` but re-declared server-side deliberately). `proposed_splits`'s internal grouping heuristic is intentionally simple (e.g. by top-level directory) — no acceptance criterion pins its exact algorithm.

**H. Smart Diff is the default view; `FileCard`/`CodeLine` gain new optional capabilities.** The feature's stated goal describes the baseline Files-changed experience, not an opt-in mode. `SmartDiffViewer` is the default; a flat "Original order" render is required only as the fallback for `useSmartDiff`'s loading/error states (a user-facing toggle is a nice-to-have, not graded). Making the badge/click-to-line behavior work requires extending `FileCard`/`CodeLine` with new OPTIONAL, backward-compatible capabilities — a findings-count badge, an externally-forceable open state, and a per-(file,line) DOM anchor — none of which exist today. The existing flat-mode smoke test must keep passing unmodified as proof nothing broke.

**I. i18n home: `prReview.json`'s existing `smartDiff` block, not `brief.json`.** The frontend implementer extends the existing block with only the new keys actually needed rather than duplicating strings under a different namespace.

## Tasks
1. Add `server/src/modules/smart-diff/constants.ts` — boilerplate/wiring classification patterns + `SMART_DIFF_TOO_BIG_LINES` — surface: `server` — owner: `implementer` (backend).
2. Add `server/src/modules/smart-diff/classify.ts` — pure `classifyFile(path: string): SmartDiffRole`, imports only from `constants.ts` — surface: `server` — owner: `implementer` (backend).
3. Add `server/src/modules/smart-diff/service.ts` — compose `PrFile[]` + latest-per-agent non-dismissed findings into `SmartDiff` (Design decisions D–G) — surface: `server` — owner: `implementer` (backend).
4. Add `server/src/modules/smart-diff/routes.ts` — `GET /pulls/:id/smart-diff`, workspace-scoped — surface: `server` — owner: `implementer` (backend).
5. Register the new module in `server/src/modules/index.ts` (one import + one line) — surface: `server` — owner: `implementer` (backend).
6. Add `client/src/lib/hooks/smart-diff.ts` — `useSmartDiff(prId)` — surface: `client` — owner: `implementer` (frontend).
7. Extend `client/src/lib/types.ts`'s `@devdigest/shared` re-exports with `SmartDiffFile`/`SmartDiffGroup`/`SmartDiffRole`/`ProposedSplit` — surface: `client` — owner: `implementer` (frontend).
8. Extend `FileCard`/`CodeLine` with new optional, backward-compatible props: findings badge, forced/controlled open state, per-line DOM anchor — surface: `client` — owner: `implementer` (frontend).
9. Build `SmartDiffViewer` under `DiffTab/_components/` — grouped sections, boilerplate collapsed by default, `split_suggestion` banner — surface: `client` — owner: `implementer` (frontend).
10. Wire `DiffTab` to fetch `useSmartDiff(prId)` and render `SmartDiffViewer` as the default view (flat fallback on load/error) — surface: `client` — owner: `implementer` (frontend).
11. Extend `prReview.json`'s existing `smartDiff` i18n block with any new keys actually needed — surface: `client` — owner: `implementer` (frontend).
12. Backend unit tests (`classify.ts`, table-driven, lock-file-always-boilerplate) + integration test (route, Docker) + client test (`SmartDiffViewer`) — owner: `test-writer`.
13. Architecture review of the new module + `diff-viewer` extension boundaries — owner: `architecture-reviewer`.
14. Security review: workspace-scoping + independently-verified zero-LLM-call surface — owner: `security-reviewer`.
15. Plan verification — owner: `plan-verifier`.
16. Record the demo (large-PR Smart Diff, run a review, badges appear, click-to-line) and open the PR with a description — surface: `e2e`/manual — owner: **orchestrator/human**.

## Agent specs

### implementer — backend (server/)
- Scope:
  - `server/src/modules/smart-diff/` (new: `constants.ts`, `classify.ts`, `service.ts`, `routes.ts`)
  - `server/src/modules/index.ts` (one import + one registry line)
  - Do NOT touch: `server/src/vendor/shared/` or `client/src/vendor/shared/` — this feature needs **zero** contract changes; if you believe otherwise, report it rather than editing either copy.
  - Do NOT touch: `server/src/db/schema/`, `server/src/db/migrations/` — no schema change (Design decision C). If you believe a table is needed, report it rather than adding a migration.
  - Do NOT touch: `server/src/modules/reviews/`, `server/src/modules/pulls/` — only import from them (`ReviewRepository`, `latestReviewsPerAgent`), matching `intent/service.ts`'s existing cross-module-import precedent.
  - Do NOT touch: `reviewer-core/` — not needed for this feature.
- Required skills: `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture`, `zod`, `security`, `typescript-expert`, `engineering-insights`.
- Acceptance criteria:
  - `classifyFile(path: string): SmartDiffRole` in `classify.ts` — pure, zero I/O, no inline regex/magic numbers (everything sourced from `constants.ts`). Unmatched paths default to `core` (fail toward MORE reviewer attention, never less).
  - `constants.ts` exports the boilerplate patterns (must catch lock files at any nesting depth — `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` — plus `*.snap`, `dist/`, `build/`, `.next/`-style generated output), the wiring patterns (config files, `index.ts`/`index.js` barrels, `tsconfig*`, `package.json`, CI config), and a named, exported `SMART_DIFF_TOO_BIG_LINES` (recommended starting point 400).
  - A lock file at any path depth MUST classify as `boilerplate` — this is a hard, graded acceptance criterion.
  - `service.ts` (`SmartDiffService`, constructed with `container: Container`, mirroring `IntentService`'s shape): `getPull(workspaceId, prId)` → `NotFoundError` if missing/wrong-workspace; `getPrFiles` for the file list (never a fresh GitHub call — Design decision D); `reviewsForPull` + `latestReviewsPerAgent` (kind `'review'` only, filtered **before** dedup) + dismissed-exclusion for findings (Design decision E); buckets findings by `file` into `finding_lines` per Design decision F; classifies every file; groups into `[core, wiring, boilerplate]` order, omitting empty groups; computes `split_suggestion` per Design decision G; `pseudocode_summary` is never populated (Design decision A).
  - **Independently verifiable hard constraint**: nothing under `smart-diff/` imports or calls `container.llm`, `completeStructured`, or any `LLMProvider` method. The whole module is traceable as synchronous DB-read + pure-function composition only.
  - `routes.ts`: `GET /pulls/:id/smart-diff`, `{schema: {params: IdParams}}`, `getContext` for `workspaceId`, delegates to `SmartDiffService`, returns `SmartDiff`. Registered as `smartDiff` in `server/src/modules/index.ts`, mirroring `intent`'s registration exactly.
  - `pnpm typecheck` and `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` pass.

### implementer — frontend (client/)
- Scope:
  - `client/src/lib/hooks/smart-diff.ts` (new)
  - `client/src/lib/types.ts` (extend the existing `SmartDiff` re-export line with its nested types)
  - `client/src/components/diff-viewer/FileCard/FileCard.tsx`, `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (new OPTIONAL props only — existing prop signatures/behavior must not change)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/` (extend `DiffTab.tsx`; new `_components/SmartDiffViewer/`)
  - `client/messages/en/prReview.json` (extend the existing `smartDiff` block only)
  - Do NOT touch: `client/src/vendor/shared/`, `client/src/vendor/ui/`, `client/messages/en/brief.json` (Design decision I), `PrDetailHeader.tsx`.
- Required skills: `frontend-architecture`, `next-best-practices`, `react-best-practices`, `zod`, `engineering-insights`.
- Acceptance criteria:
  - `useSmartDiff(prId)` — `useQuery({queryKey: ["smart-diff", prId], queryFn: () => api.get<SmartDiff>(\`/pulls/${prId}/smart-diff\`), enabled: !!prId})`. No mutation.
  - `SmartDiffViewer` renders `groups` as labeled sections (`prReview.json`'s `smartDiff.coreLabel`/`wiringLabel`/`boilerplateLabel`) in server-returned order — do not re-sort client-side. Each file renders through the EXISTING `FileCard`/`CodeLine` machinery: join `SmartDiffFile` against the full `PrFile[]` (passed alongside the `SmartDiff` data) by `path` to recover `patch`. A `SmartDiffFile` with no matching `PrFile` is skipped, not crashed on.
  - The `boilerplate` section has its own section-level collapse toggle, **collapsed by default**, independent of each `FileCard`'s own open/closed state — hard, graded criterion.
  - Every file with `finding_lines.length > 0` shows an "N findings" badge in its `FileCard` header; zero-finding files show none. Clicking the badge: expands the boilerplate section if needed, expands that file's own `FileCard` if collapsed, scrolls to and visually highlights the line at `finding_lines[0]`. Choose and document your click-to-line mechanism and report it.
  - `SmartDiffViewer` forwards the same `commenting: DiffCommentApi` prop into every `FileCard` it renders, exactly as today's flat `DiffViewer` — no regression to inline PR comments.
  - When `split_suggestion.too_big`, render a banner using `smartDiff.largeTitle`/`largeBody` (`{lines}` = `total_lines`) listing `proposed_splits` (name + file count); omit it otherwise.
  - `DiffTab` fetches `useSmartDiff(prId)` itself and renders `SmartDiffViewer` as the default view; falls back to the flat `DiffViewer` only on `useSmartDiff` loading/error. A "Smart order / Original order" toggle is optional — if skipped, say so in your report.
  - New i18n keys, if any, added under `prReview.json`'s `smartDiff` block only; read via `useTranslations("prReview")` then `t("smartDiff.<key>")`.
  - `pnpm typecheck` and `pnpm test` pass, **including** `client/src/test/smoke.test.tsx` unmodified and still green.

### test-writer
- Scope: new/changed test files only, across `server/` and `client/` — no implementation edits.
- `server/test/smart-diff-classify.test.ts` (unit, no Docker) — table-driven over `classifyFile`: lock files at various nesting depths → `boilerplate`, `*.snap`/`dist/**`/`build/**` → `boilerplate`, config/index/`tsconfig.json`/`package.json` → `wiring`, ordinary source files → `core`, unusual/unmatched path defaults to `core`.
- `server/test/smart-diff.it.test.ts` (Docker, mirrors `pulls-findings-rollup.it.test.ts`'s shape) — asserts: response parses as `SmartDiff`; a seeded lock file lands in `boilerplate`; findings from the latest review per agent (excluding a dismissed one, excluding a superseded older review from the same agent) map into the correct file's `finding_lines` with a count matching the true finding count; a finding on a file outside the PR's file list doesn't appear anywhere and doesn't error; cross-workspace PR id → 404. Additionally: build the app with no usable LLM provider (or a double that throws on any `complete*` call) and assert the route still succeeds.
- Client: `SmartDiffViewer.test.tsx` (RTL, `NextIntlClientProvider` + `messages/en/prReview.json`) — boilerplate section collapsed by default, a file with findings renders a correctly-counted badge, clicking it produces an observable expand/scroll effect.
- Run: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (+ `smart-diff.it.test.ts` if Docker is available), `cd client && pnpm test`.

### architecture-reviewer
- Scope: `server/src/modules/smart-diff/`, `server/src/modules/index.ts`, and the client `diff-viewer`/`DiffTab`/`SmartDiffViewer`/hook changes.
- Load `onion-architecture` and `frontend-architecture` first.
- Check: `service.ts` goes through `ReviewRepository`'s existing `getPrFiles`/`reviewsForPull` (no raw `db` queries, no duplicate query layer); the module never imports `container.llm`/any `LLMProvider` (verify independently); `reviewer-core/` is genuinely untouched; `FileCard`/`CodeLine` extensions are additive/optional; `SmartDiffViewer`'s co-location under `DiffTab/_components/` is still the right call given what was actually built.

### security-reviewer
- Scope: `GET /pulls/:id/smart-diff` and `smart-diff/service.ts`.
- Load the `security` skill first.
- Check: workspace-scoping via `getContext` + `getPull(workspaceId, prId)` → `NotFoundError`; dismissed findings are genuinely excluded from `finding_lines`; zero new `process.env` reads; independently confirm the zero-new-LLM-call claim (`grep -rn "container\.llm\|completeStructured\|\.complete(" server/src/modules/smart-diff/` → nothing).

### plan-verifier
- Scope: this plan plus the resulting diff.
- Check every Task/Acceptance criterion against actual files/tests. Specifically verify: `pseudocode_summary` is null/unset everywhere; no vendored-contract file was touched; no `db/schema`/`db/migrations` diff; `constants.ts` genuinely holds the patterns/thresholds; the lock-file-always-boilerplate unit test exists and passes; i18n additions landed in `prReview.json`'s `smartDiff` block, not `brief.json`; `client/src/test/smoke.test.tsx` still passes unmodified.

## Risks / open questions
- **Vendored-contract copies** — already resolved: both `brief.ts` copies are byte-identical; this feature needs zero contract edits anyway.
- **Click-to-line anchoring has no existing precedent** — the largest net-new client-engineering surface in the plan; the frontend implementer must choose an approach and report it.
- **"Smart order / Original order" toggle is optional/nice-to-have** — not graded; may be skipped.
- **Two reasoned-but-underspecified interpretations** worth confirming: `split_suggestion.total_lines` excluding boilerplate (Design decision G), and `finding_lines` = one `start_line` per surviving finding with no dedup (Design decision F).
- **`SMART_DIFF_TOO_BIG_LINES`'s exact value** (400 recommended) is a product judgment call the acceptance criteria never directly test.
- **Demo + PR are orchestrator/human work** — recorded against the running full stack, not producible by `implementer`/`test-writer`.
- **`FileCard`/`CodeLine` extended in place vs. forked** — this plan recommends extending in place (avoids duplicating `parsePatch`/`buildThreads`/comment-threading logic); if `architecture-reviewer` judges that coupling unacceptable, forking is the fallback.
