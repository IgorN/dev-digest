# Development Plan: Intent Layer

## Goal
Before the main review runs, derive a cheap, structured "why was this PR opened" — a summary + explicit in-scope/out-of-scope lists — from title/body/linked-issue/file-list-and-hunk-headers (never diff bodies). Persist it per-PR, recompute it only on explicit user action, inject it into the review prompt with a scope-discipline instruction, surface it as a card on the PR Overview tab, and log enough to empirically verify no diff-body leakage and the token/cost savings versus including diff bodies.

## Affected surfaces
- `server/` — new `intent` module (classifier, recompute/read routes), `run-executor.ts` wiring (load + inject), `resolveFeatureModel` reuse, `RunLogger` reuse, one vendored-contract edit (`FEATURE_MODELS['review_intent'].defaultModel`).
- `reviewer-core/` — new optional `intent` field threaded through `ReviewInput` → `PromptParts` → `assemblePrompt`, rendering a new `## Intent` section and a scope-discipline instruction.
- `client/` — Intent card on the PR Overview tab, `useIntent`/`useRecomputeIntent` hooks, new i18n keys in the already-existing-but-unconsumed `brief.json` namespace.
- `e2e/` — not assigned a task in this plan (see Risks/open questions — flagged, not owned by an `implementer`).

## Relevant existing insights

- `server/INSIGHTS.md`: "The cheap extraction model (`openrouter/deepseek-v4-flash`) intermittently replies in CHINESE for an open-ended 'extract rules' prompt — the system prompt MUST say 'Respond in ENGLISH only'... Also: a structured `completeStructured` call is non-deterministic even at `temperature:0`." — directly applicable: the classifier's system prompt must include the English-only instruction, and recompute producing slightly different phrasing each run is expected, not a bug.
- `server/INSIGHTS.md`: "Adding a NEW required field to a persisted document contract breaks reading old rows... Use `.nullish()` for fields added to already-persisted contracts." — applies directly to the new `PromptAssembly.intent` field (old `run_traces` rows have no `intent` key).
- `server/INSIGHTS.md`: "`@devdigest/shared` contracts are vendored as TWO hand-maintained copies... Adding a field means editing both in lock-step." — applies to both `trace.ts` (`PromptAssembly.intent`) and `platform.ts` (`FEATURE_MODELS['review_intent'].defaultModel`) — both are lock-step, orchestrator-only edits per this repo's convention (implementers must not touch either vendor copy themselves).
- `server/INSIGHTS.md`: "Wiring skills into a review run is one fetch in `run-executor.ts`... A DISABLED skill stays linked but is omitted — that omission is exactly the control-experiment lever." — the `callers`/`repoMap`/`skills` omit-when-absent pattern in `run-executor.ts` is the exact template `intent` wiring should follow (verified directly: `run-executor.ts:174-223` uses `...(x ? { x } : {})` spread for every optional prompt part).
- `server/INSIGHTS.md`: "New DB column flow: edit `db/schema/*.ts` → `pnpm db:generate` → `pnpm db:migrate`... NEVER hand-author the SQL." — not needed here since `pr_intent` table already exists with the exact required shape (verified directly, no schema change needed for this feature).
- `client/INSIGHTS.md`: "Adding a required field to a vendored Zod contract breaks test fixtures that build the full type from a `Partial<>` helper." — relevant if any client test fixture builds a full `PromptAssembly`/trace object; the new `intent` field should be added as nullish/optional there too, mirroring the server-side lesson.
- `client/INSIGHTS.md`: "A repo-scoped page... gets the active repo from `useActiveRepo()`" and "Data fetching goes through the hooks in `src/lib/hooks/`, not raw fetch in components" — the Intent card and its hooks must follow this, not hand-roll fetch.
- `reviewer-core/INSIGHTS.md`: none relevant found (file has no entries yet under any section).

## Confirmed already-built (do not re-implement)
Verified directly by reading the code (not just trusting the request's own claims):
- `pr_intent` table exact shape — `server/src/db/schema/reviews.ts:48-55`.
- `Intent` zod contract `{intent, in_scope, out_of_scope}` — `server/src/vendor/shared/contracts/brief.ts:9-14`.
- `upsertIntent`/`getIntent` at both the row level (`server/src/modules/reviews/repository/pull.repo.ts:49-68`) and the `ReviewRepository` facade (`server/src/modules/reviews/repository.ts:130-136`) — callable as `this.repo.getIntent(prId)` / `this.repo.upsertIntent(prId, intent)` from inside `ReviewRunExecutor` (same `repo` field it already has).
- `FEATURE_MODELS` registry already lists `review_intent` (id, label, description, default provider/model) at `platform.ts:52-58` in both vendor copies (confirmed byte-identical), and `resolveFeatureModel(container, workspaceId, 'review_intent')` (`server/src/modules/settings/feature-models.ts:51-57`) already resolves workspace-override-or-default with zero new code needed.
- Client Settings model picker (`SettingsModels.tsx`) generically iterates `FEATURE_MODELS` — `review_intent` already gets a working picker with zero new UI code.
- `client/messages/en/brief.json` already has `block.intent`, `unavailable`, `unavailableHint` — zero current consumers (confirmed by grep: only the card being built in this plan will consume them).
- `DiffHunk` (`server/src/vendor/shared/adapters.ts:175-183`) already carries only `{file, oldStart, oldLines, newStart, newLines, newLineNumbers}` — numeric hunk boundaries, no line-body text — so "no diff bodies" is satisfied with zero shared-type changes.
- `OctokitGitHubClient.getPullRequest` (`server/src/adapters/github/octokit.ts:70-124`) returns `PrDetail` including `body`, `files[].patch`, and `linked_issue` (via `resolveLinkedIssue`, `octokit.ts:127-135`, first `#N` match only) in one call — no new GitHub adapter code needed.
- **New finding, not previously confirmed by the request**: `ReviewRunExecutor`'s own docstring already says "Loads the diff + intent once" (`run-executor.ts:39,52`) but the actual code only loads `diff` (`run-executor.ts:95-105`) — `getIntent` is never called anywhere in `run-executor.ts` today (confirmed by grep across the whole `reviews` module: `upsertIntent`/`getIntent` only appear in `repository.ts`/`pull.repo.ts`, never in `run-executor.ts` or `service.ts`). The comment is aspirational/pre-written for this lesson, not evidence of existing wiring — this plan's Task 5 closes that exact gap.

## Gaps confirmed by direct read (this plan's net-new work)
1. No `server/src/modules/intent/` module exists; `server/src/modules/index.ts:26-37` has no `intent` entry.
2. `FEATURE_MODELS['review_intent']` currently defaults to `{provider: 'openai', model: 'gpt-4.1'}` (`platform.ts:52-58`, both vendor copies) — not a cheap flash-class model. Needs to change to match this lesson's "cheap classifier" requirement.
3. `ReviewInput`/`PromptParts`/`assemblePrompt` (`reviewer-core/src/review/run.ts:44-93`, `reviewer-core/src/prompt.ts:39-141`) have no `intent` field or rendering path at all — `INJECTION_GUARD` only name-checks "derived intent/scope" as one of several untrusted categories (`prompt.ts:18`) without ever rendering one.
4. `PromptAssembly` (`trace.ts:39-53`, both vendor copies) has no `intent` field.
5. `run-executor.ts` never calls `getIntent` (see finding above) — the read-and-inject wiring doesn't exist yet.
6. `OverviewTab.tsx` (22 lines) renders only a Description section — no Intent card, no `prId` prop even, today.
7. No `client/src/lib/hooks/intent.ts` (or equivalent) exists.

## Tasks

1. Change `FEATURE_MODELS['review_intent'].defaultModel`/`defaultProvider` to a cheap OpenRouter flash model (e.g. `openrouter`/`deepseek/deepseek-v4-flash`, matching `onboarding`'s existing default) in BOTH vendor copies — surface: `server`+`client` vendor (lock-step) — owner: **orchestrator/human** (not a parallel `implementer` — see Risks).
2. Add `intent: z.string().nullish()` to `PromptAssembly` in BOTH vendor copies of `trace.ts` — surface: `server`+`client` vendor (lock-step) — owner: **orchestrator/human**.
3. Build the classifier (`buildUserMessage`, system prompt, `completeStructured` call returning `{data, tokensIn, tokensOut, costUsd}`) reusing the existing `Intent` schema — surface: `server` — owner: `implementer` (backend).
4. Build the input-gathering step: file list + synthesized hunk-header lines (no diff bodies), PR title/body/linked-issue via existing `PrDetail` — surface: `server` — owner: `implementer` (backend).
5. Build the new `server/src/modules/intent/` module: recompute route (sync, single LLM call), read route (or confirm folding into `GET /pulls/:id`), register in `modules/index.ts` — surface: `server` — owner: `implementer` (backend).
6. Thread a `RunLogger`/`Logger` through the classifier: log composed-input sizes (title/body length, linked-issue present/absent, file count, hunk-header line count) before the call, and `tokensIn`/`tokensOut`/`costUsd` after — surface: `server` — owner: `implementer` (backend).
7. Wire `run-executor.ts` to call `this.repo.getIntent(pull.id)` (read-only) and pass it into `reviewPullRequest`'s new `intent` field when present, omitting the section when absent — surface: `server` — owner: `implementer` (backend).
8. Add the optional `intent` field to `ReviewInput` → `PromptParts` → `assemblePrompt`, rendering a new `## Intent` section (delimiter-wrapped) with the "stay inside scope / one signal finding" instruction — surface: `reviewer-core` — owner: `implementer` (backend, same instance as tasks 3-7 or a dedicated reviewer-core implementer — see Agent specs).
9. Build `useIntent(prId)` / `useRecomputeIntent(prId)` hooks — surface: `client` — owner: `implementer` (frontend).
10. Build the Intent card (summary quote, In scope / Out of scope lists, EmptyState + recompute CTA) and mount it in `OverviewTab` — surface: `client` — owner: `implementer` (frontend).
11. Add new i18n keys to `client/messages/en/brief.json` for section labels not already present (`block.intent`/`unavailable`/`unavailableHint` already exist) — surface: `client` — owner: `implementer` (frontend).
12. Write/extend tests for the classifier, prompt assembly, and the new routes/hooks/components — surface: all three — owner: `test-writer` (one pass per surface, or combined if scope allows).
13. Review the finished diff for onion-architecture/frontend-architecture boundary issues — owner: `architecture-reviewer`.
14. Review the finished diff for security issues (new endpoint, LLM input assembly, no new auth surface expected but confirm) — owner: `security-reviewer`.
15. Verify the plan was fully implemented — owner: `plan-verifier`.
16. (Optional, if scope requires) e2e coverage for "recompute intent → card updates → review references it" — surface: `e2e/` — owner: **orchestrator/human**, not assigned to `implementer`/`test-writer`.

## Design decisions baked into this plan (resolved, not open questions)

**A. Graceful degradation (empty body/no issue/no spec).** The classifier's `buildUserMessage` must build the same message shape regardless of which fields are present/absent — never throw, skip, or early-return on an empty body. When `body` is empty/null and `linked_issue` is absent, the message still includes title + file list + hunk-header lines, and the system prompt explicitly instructs the model to do its best-effort inference from implicit signal alone in that case. This mirrors `conventions/extract.ts`'s unconditional-run pattern (no precondition gate on file *content* richness). Acceptance: a fixture PR with `body: null`, no linked issue, and only file/hunk data still produces a valid `Intent` object (not a thrown error, not a "cannot infer" placeholder).

**B. Spec/plan detection.**
- *Inline* plan/spec text in the PR body or linked-issue body: captured "for free" because the classifier's input already includes the full raw body text — the plan explicitly directs implementers NOT to aggressively truncate the body before it reaches the model (no `MAX_FILE_CHARS`-style hard slice on the PR body/issue body the way `reviewer-core`'s `assemblePrompt` truncates prDescription at 4000 chars for the MAIN review — that truncation is a different, later-stage concern for a different prompt; the classifier's own input assembly should pass the body through whole, or with a much larger cap chosen deliberately if token budget requires one — document the chosen cap, if any, in the code comment).
- *External* link/reference (Notion/Jira/Confluence/etc.) in body text: visible to the model as plain text (its presence/context can still inform framing) but fetching/resolving it is explicitly OUT OF SCOPE for this lesson — no new HTTP client, no new adapter, no new secret. This is a deliberate scope boundary, not an oversight — call it out in the classifier module's own doc comment so a future lesson doesn't have to rediscover the boundary.

**C. Hunk-header synthesis approach.** Recommended and adopted: synthesize `@@ -{oldStart},{oldLines} +{newStart},{newLines} @@` lines directly from `DiffHunk`'s existing numeric fields, in a small formatter local to the new `intent` module. No changes to `DiffHunk`, `parseUnifiedDiff`, or any shared/vendored type. (Rejected alternative: extending `DiffHunk` with git's real trailing function-name header text — would require a parser regex change to a shared type; not justified unless the plain numeric synthesis proves insufficient, which nothing in this request suggests.)

**D. Diff source for the classifier's file/hunk list.** The recompute route builds its own diff via `loadDiff(container, repo, workspaceId, pull, repoRow)` (`server/src/modules/reviews/diff-loader.ts`) — the SAME function `run-executor.ts` uses for the main review — rather than depending on a review having already run. This makes the classifier callable standalone (before any review exists for the PR), matching the requirement that intent is computed independently of a full review pass.

**E. Route shape.** `POST /pulls/:id/intent/recompute` — fully synchronous (mirrors `conventions`'s `POST /repos/:id/conventions/extract`, not `repo-intel`'s async-queued pattern), because this is a single cheap LLM call with the same latency/cost profile as conventions extraction, not a multi-step pipeline needing a job queue. Read path: add a small dedicated `GET /pulls/:id/intent` returning `Intent | null`, keeping `PrDetail` untouched and the concern cleanly separated (this route belongs in the new `server/src/modules/intent/routes.ts`, module-scoped like conventions' own routes, not bolted onto `pulls/routes.ts`).

**F. Trust-model placement of the scope-discipline instruction.** The "stay inside `in_scope`, one signal finding for genuinely serious out-of-scope issues" instruction is rendered inside the new `## Intent` section itself (next to the untrusted-wrapped intent content), not folded into `INJECTION_GUARD`. Rationale: `INJECTION_GUARD` is the ONE shared, always-on defense against untrusted content overriding reviewer judgment — it must stay generic and not accrete feature-specific behavioral instructions. The intent-scope instruction is a legitimate STEERING instruction (not a security defense), conditional on the section's presence (omitted entirely when no intent exists), so it belongs colocated with the section it modifies, written as trusted framing text OUTSIDE the `wrapUntrusted()` block (only the intent's `summary`/`in_scope`/`out_of_scope` VALUES — which came from an upstream LLM call and are therefore semi-trusted-but-derived, same trust tier as `repoMap`/`callers` — go inside the untrusted wrapper; the instruction telling the model how to USE that content is trusted authorial text, same tier as everything else in `PromptParts.system`/section headers).

## Agent specs

### implementer — backend (server/ + reviewer-core/)
Recommendation: run these as ONE implementer instance, not two in parallel, because the `intent` field threads through both packages in a single logical chain (`ReviewInput.intent` → `PromptParts.intent` → `assemblePrompt` rendering, then `run-executor.ts` populating that same field) and splitting it risks a signature mismatch discovered only at typecheck time across two independent agents. If the calling process prefers strict one-implementer-per-package parallelism instead, split as backend (`server/`) + a second instance for `reviewer-core/` only, with the backend instance's spec listing `reviewer-core`'s NEW field names as a hard contract it must match exactly (do not implement independently on both sides without agreeing the field name first).

- Scope:
  - `server/src/modules/intent/` (new: `extract.ts` classifier, `hunk-format.ts` or similar for header synthesis, `service.ts`, `routes.ts`, `constants.ts` if a model constant is needed)
  - `server/src/modules/index.ts` (one import + one registry line)
  - `server/src/modules/reviews/run-executor.ts` (add `getIntent` read + pass into `reviewPullRequest`)
  - `reviewer-core/src/review/run.ts` (`ReviewInput.intent?`)
  - `reviewer-core/src/prompt.ts` (`PromptParts.intent?`, `assemblePrompt` rendering of `## Intent`)
  - Do NOT touch: `server/src/vendor/shared/` or `client/src/vendor/shared/` (report the exact `PromptAssembly.intent` and `FEATURE_MODELS['review_intent'].defaultModel` changes needed instead — orchestrator applies both vendor copies in lock-step)
  - Do NOT touch: `server/src/db/schema/`, `server/src/db/migrations/` (no schema change needed — `pr_intent` already has the right shape)
- Required skills: `fastify-best-practices`, `drizzle-orm-patterns` (only if any new query beyond the existing `getIntent`/`upsertIntent` is needed — likely none), `onion-architecture`, `zod` (reusing the `Intent` schema — confirm no new schema is invented), `security` (new endpoint touching PR content + LLM input assembly), `typescript-expert`, `engineering-insights`.
- Acceptance criteria:
  - Classifier: one `completeStructured` call, `Intent` schema (imported, not redefined), system prompt includes an explicit "Respond in ENGLISH only" instruction, `temperature: 0`, provider/model resolved via `resolveFeatureModel(container, workspaceId, 'review_intent')` → `container.llm(provider)` (same pattern as `run-executor.ts:159-161`).
  - Input assembly never includes any diff hunk BODY text (+/- lines) — only title, body (untruncated or documented-cap), linked issue title+body, file paths, and synthesized `@@ -a,b +c,d @@` hunk-header lines. A unit test asserts the assembled message string contains no line starting with `+` or `-` from the diff (excluding the synthesized `@@` markers themselves).
  - Empty-body/no-issue PR still produces a valid `Intent` (design decision A) — a test fixture with `body: null`, no `linked_issue` passes through the same code path without throwing/skipping.
  - `POST /pulls/:id/intent/recompute` — synchronous, loads `PrDetail` + diff (via `loadDiff`), calls classifier, `upsertIntent`s, returns the `Intent`. `GET /pulls/:id/intent` returns the persisted `Intent | null`. Both registered via a new `server/src/modules/intent/routes.ts` + one line in `modules/index.ts`.
  - `run-executor.ts` calls `this.repo.getIntent(pull.id)` once per run (read-only — never triggers recompute) and passes it into `reviewPullRequest({ ...intent ? {intent} : {} })`, matching the existing omit-when-absent convention.
  - `RunLogger` (or its `Logger` type when outside a run context) logs, BEFORE the LLM call: title length, body length, linked-issue present/absent, file count, hunk-header line count — explicitly never the diff body. AFTER the call: `tokensIn`/`tokensOut`/`costUsd`.
  - `reviewer-core`: `ReviewInput.intent?: Intent`, `PromptParts.intent?: Intent`, `assemblePrompt` renders a new `## Intent` section (delimiter-wrapped via `wrapUntrusted`) containing the summary/in_scope/out_of_scope values, with the scope-discipline instruction as trusted framing text adjacent to (not inside) the untrusted block, matching design decision F. Section omitted entirely when `intent` is undefined (no assembly/token-count change to the baseline when absent — same contract as `callers`/`repoMap`).
  - `pnpm typecheck` (server), `npm run typecheck` (reviewer-core) pass.
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` and `cd reviewer-core && npm test` pass.
  - Report back the EXACT vendored-contract diffs needed (both `PromptAssembly.intent` addition and the `FEATURE_MODELS['review_intent']` default change) as text in the final report — do not apply them.

### implementer — frontend (client/)
- Scope:
  - `client/src/lib/hooks/intent.ts` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/` (extend `OverviewTab.tsx` to accept `prId` and mount the new Intent card; add a co-located `_components/IntentCard/` or similar)
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (pass `prId` into `OverviewTab`)
  - `client/messages/en/brief.json` (add new keys only; the three existing keys — `block.intent`, `unavailable`, `unavailableHint` — stay as-is)
  - Do NOT touch: `client/src/vendor/shared/`, `client/src/vendor/ui/` (read-only templates for `Card`/`SectionLabel`/`Badge`/`EmptyState`)
- Required skills: `frontend-architecture`, `next-best-practices` (data-fetching/hook conventions), `react-best-practices`, `zod` (only if a client-side type needs re-deriving — likely just imports `Intent` from `@devdigest/shared`), `react-testing-library` is `test-writer`'s concern, not this implementer's, `engineering-insights`.
- Acceptance criteria:
  - `useIntent(prId)` — `useQuery(["intent", prId], () => api.get<Intent | null>(\`/pulls/${prId}/intent\`), {enabled: !!prId})`, modeled on `usePrReviews` (`reviews.ts:51-57`).
  - `useRecomputeIntent(prId)` — `useMutation` posting to `/pulls/${prId}/intent/recompute`, writing the result straight into `["intent", prId]` via `setQueryData` on success, modeled on `useExtractConventions` (`conventions.ts:37-43`).
  - `OverviewTab` gains a `prId` prop; renders the new Intent card as a sibling `<section>` alongside the existing Description section (not replacing it), inside the same flex-column container the page already provides (`page.tsx:136`) — no new page-level layout wrapper needed.
  - Intent card states: loading (skeleton or inline loading, match existing convention), not-yet-computed (`EmptyState` with `unavailable`/`unavailableHint` strings + a recompute CTA), and populated (summary quote + two lists — In scope / Out of scope — built with `Card`/`SectionLabel` primitives, a small local `styles.ts` for the two-list layout since no existing two-column list primitive exists in this codebase).
  - Recompute button present in BOTH the empty and populated states (recompute is explicit, not automatic — matches the product requirement that intent may need re-deriving after PR changes).
  - Explicitly OUT of this card's scope: no "RISK AREAS" chips/tags (not part of the `Intent` contract; belongs to a later Risks/`pr_brief` lesson if ever built) — confirm this is NOT added.
  - i18n: all new user-facing strings go into `brief.json` under the existing `block`/top-level structure; `useTranslations("brief")` is the hook used (matching `useTranslations("conventions")`'s existing pattern in `ConventionCard.tsx:22`).
  - `pnpm typecheck` and `pnpm test` pass for `client/`.

### test-writer
- Scope: new/changed test files only, across all three surfaces — no implementation edits.
- Backend (`server/test/`, flat directory, no colocated per-module tests in this repo):
  - A new `server/test/intent-extract.test.ts` (unit, mirrors `server/test/extract.test.ts`'s conventions-extraction test shape) covering: the classifier never includes diff-body +/- lines in its assembled message (given a fixture diff), the empty-body/no-linked-issue degradation path (design decision A) still returns a valid `Intent`, and the English-only system-prompt instruction is present in the system message.
  - A new `server/test/intent.it.test.ts` (Docker-backed, mirrors `server/test/conventions.it.test.ts`) covering `POST /pulls/:id/intent/recompute` (persists via `upsertIntent`, returns the `Intent`) and `GET /pulls/:id/intent` (returns persisted value, returns `null`/404 appropriately when none computed yet — decide and test one contract).
  - Extend `reviewer-core/test/prompt.test.ts` (mirrors the existing `prompt-callers.test.ts`/`prompt-structured.test.ts` shape at `server/test/`, but this one lives under `reviewer-core/test/`) with cases: `## Intent` section renders when `parts.intent` is present, is entirely omitted when absent (assembly/token-count parity with baseline), and the scope-discipline instruction text appears in the rendered section.
- Skills: no dedicated backend-testing skill (match surrounding `*.test.ts` conventions directly, per `test-writer`'s own instructions); `zod` for schema-heavy assertions; `react-testing-library` for the client piece below.
- Client: a test for `IntentCard`/`OverviewTab` covering the three states (loading/empty/populated) and that the recompute button is present in both empty and populated states — following the existing RTL conventions already used for `RunCostBadge.test.tsx` etc.
- Run only: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (+ the new `.it.test.ts` only if Docker is available in this environment — otherwise report it as written-but-unrun), `cd reviewer-core && npm test`, `cd client && pnpm test`.

### architecture-reviewer
- Scope: the full diff across `server/src/modules/intent/`, `server/src/modules/reviews/run-executor.ts`, `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, and the client `OverviewTab`/hooks changes.
- Load `onion-architecture` and `frontend-architecture` before reviewing.
- Specifically check: the new `intent` module doesn't reach into `reviews`' repository internals directly (should go through `ReviewRepository`'s existing `getIntent`/`upsertIntent`, not a new duplicate query); `reviewer-core` stays I/O-free (the classifier's LLM call and any logging must stay server-side, never in `reviewer-core`); the client Intent card fetches via hooks, not raw `fetch` in the component.

### security-reviewer
- Scope: the new `POST /pulls/:id/intent/recompute` and `GET /pulls/:id/intent` routes, and the classifier's prompt-assembly code (new external-content-into-LLM-prompt surface).
- Load the `security` skill first.
- Specifically check: workspace-scoping on both new routes (must resolve `workspaceId` via `getContext` like every other route in this codebase, e.g. `pulls/routes.ts:242` / `conventions/routes.ts:36`) so one workspace can't recompute/read another's PR intent; the classifier's prompt-assembly must not leak secrets/tokens into logged sizes (the logging task logs LENGTHS/COUNTS, never raw content — confirm this); confirm no new `process.env` read (must go through `container.secrets`, per this repo's own convention already called out in root `CLAUDE.md`).

### plan-verifier
- Scope: this plan (`.claude/plans/intent-layer.md`) plus the resulting diff.
- Check every Task and every Acceptance criterion above against actual files/tests; explicitly verify the two vendored-contract edits (`PromptAssembly.intent`, `FEATURE_MODELS['review_intent'].defaultModel`) were applied to BOTH copies, not just reported by the implementer.
- Flag if the orchestrator forgot to apply the implementer's reported vendor-contract diffs — this is the single most likely completeness gap given the lock-step-by-hand nature of that step.

## Risks / open questions

- **Vendored contract edits are orchestrator-only, not assignable to a parallel `implementer`.** Both `PromptAssembly.intent` (trace.ts) and `FEATURE_MODELS['review_intent'].defaultModel` (platform.ts) live in `server/src/vendor/shared/` AND `client/src/vendor/shared/` — per this repo's own convention and the `implementer` agent's own rule ("Never edit either copy yourself"), the backend implementer must REPORT these two changes rather than apply them, and the orchestrator/human must apply both copies in lock-step before `plan-verifier` runs (otherwise typecheck will pass on the server side while the client's copy silently drifts, which is exactly the kind of gap `server/INSIGHTS.md` already warns about).
- **`GET /pulls/:id/intent` return contract when nothing has been computed yet** — this plan recommends returning `Intent | null` (200 + null body) rather than 404, so the client's `EmptyState` path is a simple falsy check rather than an error-boundary case — but this is a judgment call the backend implementer should confirm/document rather than silently deciding either way.
- **e2e coverage is out of this pipeline's scope by design** — if the calling process wants an end-to-end "recompute → card updates → review references intent" check, that's an orchestrator/human task against the running full stack (`./scripts/dev.sh`), not something `implementer`/`test-writer` can produce (per this repo's own pipeline README: "the e2e/ surface has no dedicated pipeline agent").
- **Model-choice default value is a genuine product decision, not purely mechanical** — this plan recommends `openrouter`/`deepseek/deepseek-v4-flash` (mirroring `onboarding`'s existing default) as the new `review_intent` default, but the requester should confirm this exact model id is still the intended "cheap flash-class OpenRouter model" before the orchestrator applies the vendor edit — it's a one-line change but affects real cost/quality tradeoffs for every workspace that hasn't explicitly overridden it in Settings.
- **Body-truncation cap for the classifier's own input** — design decision B recommends NOT aggressively truncating the PR body (to preserve inline plans/specs) but doesn't mandate zero cap; the backend implementer should pick and document a generous-but-bounded cap (or no cap) rather than silently reusing the main review's unrelated 4000-char `MAX_PR_DESCRIPTION_CHARS` constant, which exists for a different prompt with different token-budget math.
- **Whether `implementer`/`reviewer-core` should run as one instance or two** — this plan recommends ONE instance covering both `server/` and `reviewer-core/` for this feature specifically, because the `intent` field's shape must be agreed identically at both ends of a chain that's exercised in the same request; if the orchestrator strongly prefers strict parallelism, split as documented above with the field-name contract pinned in both specs up front.
