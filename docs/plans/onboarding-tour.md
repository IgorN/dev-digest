# Implementation Plan: Onboarding Tour (per-repo onboarding generator)

## Overview
Turn the already-computed repo-intel index into a human-readable, 5-section "first day"
onboarding tour per repo: facts gathered deterministically at zero LLM cost, narrative
written by exactly one structured LLM call, with a degrade-never-throw skeleton + honest
badge when the index is absent/degraded. This wires up existing-but-unused scaffolding
(the `Onboarding` contract, `onboarding` table, `onboarding.system.md` prompt,
`FEATURE_MODELS['onboarding']`) into a working server module and client page, mirroring
the proven `intent`/`blast`/`context` patterns.

## Source spec
`specs/2026-07-18-onboarding-tour.md` (SPEC-2026-07-18-onboarding-tour, approved). Its
`AC-1`…`AC-21` are the traceability keys used throughout this plan. Decisions D1–D3 are
settled inputs, not open questions.

## Execution mode
multi-agent (parallel) — chosen by the user. The plan is shaped as phases with a
dependency DAG and strictly non-overlapping `Owned paths`; the contract is defined first
(T1) so server and client streams can proceed concurrently behind it.

## Grounding verified (reuse — do NOT rebuild)
Each item below was confirmed against the code while planning:
- **Contract exists** in both vendored copies (`{server,client}/src/vendor/shared/contracts/knowledge.ts:44-47`):
  `Onboarding { sections }`, `OnboardingSection`, `OnboardingLink`. Re-exported by both
  `vendor/shared/index.ts`. Needs the additive extension in T1.
- **DB table already migrated** — `onboarding` (`repoId` PK, `json` JSONB, `generatedAt`)
  is defined in `server/src/db/schema/context.ts:120-126` and present in the `0000_init.sql`
  migration and every snapshot from `0002_snapshot.json` onward. **No new migration, no
  schema task.**
- **Prompt template ready** — `server/src/prompts/onboarding.system.md` has `{{sections}}`
  + `{{language}}` placeholders, `<untrusted>` + grounding + Mermaid rules. Loaded via
  `renderPrompt('onboarding.system.md', { sections, language })`
  (`server/src/platform/prompts.ts`). Minor: its inline example still mentions a
  `routes_and_apis` kind (aligned in T4).
- **Model resolution** — `resolveFeatureModel(container, workspaceId, 'onboarding')`
  (`server/src/modules/settings/feature-models.ts`) → default `openrouter` /
  `deepseek/deepseek-v4-flash` (`vendor/shared/contracts/platform.ts:45-53`).
- **repoIntel facade** — `getIndexState`, `getRepoMap`, `getTopFilesByRank(repoId, n, {exclude})`,
  `getCriticalPaths`, `getFileRank`, `getSymbolsInFiles` all exist on the `RepoIntel`
  interface (`server/src/modules/repo-intel/types.ts:137-172`), array methods return `[]`
  when degraded, object methods carry inline `degraded`/`reason`; `getIndexState` always
  works. Reached only via `container.repoIntel.*`.
- **Clone reads** — deterministic `container.git.listFiles(repo)` and
  `container.git.readFile(repo, path)` (`server/src/adapters/git/simple-git.ts:140,150`),
  exactly as the `context` module uses them; `repo.clonePath === null` is the no-clone case.
- **Mirror modules** — `blast` (service `get()`+`recompute()`, `GET`/`POST …/recompute`,
  ONE `completeStructured` call, cost log line) and repo-scoped `context`
  (`GET /repos/:id/context`, workspace-scoped `getRepo(workspaceId, repoId)`, no-clone
  empty envelope).
- **Client** — TanStack hooks `useBlast`/`useRecomputeBlast` (`client/src/lib/hooks/blast.ts`)
  over `api.get`/`api.post`; repo-scoped pages under `client/src/app/repos/[repoId]/*` read
  `useParams<{repoId}>()`; shared `Markdown` (`client/src/vendor/ui/primitives/Markdown.tsx`,
  react-markdown@9) and `MermaidDiagram` (`client/src/components/mermaid-diagram/MermaidDiagram.tsx`,
  silently drops invalid diagrams); nav registry `client/src/vendor/ui/nav.ts` (client-only,
  no server mirror); i18n `client/messages/en/onboarding.json` (auto-discovered) via
  `useTranslations('onboarding')`.

## Requirements (verified)
- **R1 (AC-1):** `GET /repos/:id/onboarding` with a persisted tour returns it, zero LLM calls.
- **R2 (AC-2):** `GET` with no tour returns 200 with a null tour, zero LLM calls.
- **R3 (AC-3):** `POST …/recompute` gathers facts → **exactly one** `completeStructured` call
  → upsert by `repoId` with fresh `generatedAt` → return the tour.
- **R4 (AC-4):** A recompute in progress is a client-visible non-duplicable "Regenerating…"
  state (server recompute is synchronous; last-write-wins on the single-row PK).
- **R5 (AC-5):** All fact gathering is exclusively `repoIntel` + local clone, **zero** LLM.
- **R6 (AC-6):** Reading-path order derives from descending `file_rank`, not name/mtime.
- **R7 (AC-7):** Exactly the 5 `kind`s in fixed order: `architecture`, `critical-paths`,
  `run-locally`, `reading-path`, `first-tasks`.
- **R8 (AC-8):** Only `architecture` may carry a non-null `diagram`; others `null` (never `''`).
- **R9 (AC-9):** Every `OnboardingLink.path` is a real path present in the gathered facts.
- **R10 (AC-10):** `first-tasks` on a usable index yields 3–5 grounded suggestions, each a real path.
- **R11 (AC-11):** Degraded/absent index or no clone → deterministic skeleton (never 5xx,
  never empty `sections`) tagged with an index-state indicator.
- **R12 (AC-12):** LLM call failure/unusable result → skeleton with reason surfaced, not 5xx.
- **R13 (AC-13):** `full` but sparse (non-JS/TS) index → valid tour degraded to available
  facts, no fabricated symbols/paths.
- **R14 (AC-14):** Client shows an honest "index unavailable/degraded" badge + reason when
  `index_state !== 'full'`.
- **R15 (AC-15):** After the single call, emit one Pino log line with at least
  `{ tokensIn, tokensOut, costUsd }` (logged, not persisted).
- **R16 (AC-16):** Client route `/repos/:repoId/onboarding` + an "Onboarding Tour" nav entry
  under WORKSPACE; existing `/onboarding` AddRepo route untouched.
- **R17 (AC-17):** No-tour page shows an empty state with a "Generate" CTA (no auto-generation).
- **R18 (AC-18):** Sections render as sanitized Markdown; `architecture.diagram` as Mermaid;
  invalid diagram renders nothing.
- **R19 (AC-19):** When a tour exists, header shows `generated_at` as relative "last refreshed"
  + a real files-indexed count (no hardcoded literals).
- **R20 (AC-20):** Clicking a listed file in any section navigates/opens the real repo file.
- **R21 (AC-21):** Every read/write is workspace-scoped; a repo in another workspace is
  not-found.

## Open questions & recommendations
- **Rec-1 (response envelope):** The spec's HTTP surface specifies `GET → { onboarding: Onboarding | null }`
  and `POST → { onboarding: Onboarding }` (an envelope), whereas `blast`/`context` return the
  bare payload. This plan follows the spec's envelope on **both** server (T5) and client (T7)
  so they stay consistent. If the user prefers codebase consistency with `blast`, switch both
  to the bare payload — but T5 and T7 must always agree. Not a spec edit; user's call.
- **Rec-2 (route param name):** Existing repo-scoped modules use `IdParams` (`:id`) not
  `:repoId`. The plan registers `GET /repos/:id/onboarding` (param `id`) to match
  `context`/`conventions`; the URL segment carries the repo UUID either way, so the client's
  `/repos/${repoId}/onboarding` is unaffected.
- **Rec-3 (facts as an internal bundle):** Keep the deterministic `FactsBundle` an internal
  server type (not a shared contract) — only the `Onboarding` payload crosses the wire. This
  avoids growing the vendored two-copy surface for data the client never sees.
- **Rec-4 (skeleton is the base, not a separate path):** Build the deterministic 5-section
  skeleton from facts *first*, then let the single LLM call enrich section `body`/`diagram`.
  On LLM failure you already hold a valid tour to persist (satisfies AC-12 with no extra
  branch). Recommended structure for T4.
- No blocking gaps — D1–D3 resolve run-locally facts, copy-button scope, and degraded
  first-tasks.

## Affected packages & contracts
- **server** (`@devdigest/api`) — new `src/modules/onboarding/` module (facts analyzer,
  single LLM call, skeleton, service, routes, repository), one-line static registration in
  `src/modules/index.ts`, a minor `src/prompts/onboarding.system.md` wording alignment.
- **client** (`@devdigest/web`) — new hooks, a repo-scoped page + components, re-keyed i18n,
  a nav entry.
- **Contracts:** the `Onboarding` payload is extended with staleness + index-state metadata
  — a **two-copy vendored** edit (`server/…/knowledge.ts` **and** `client/…/knowledge.ts`),
  lock-step, **orchestrator/human** (T1). `client/src/vendor/ui/nav.ts` is also vendored
  (client-only, no server mirror) → orchestrator/human (T11). `reviewer-core` is not touched.

## Architecture changes
- New Fastify plugin `server/src/modules/onboarding/routes.ts` (transport ring) registered
  statically in `server/src/modules/index.ts` — `GET /repos/:id/onboarding`,
  `POST /repos/:id/onboarding/recompute`.
- `server/src/modules/onboarding/service.ts` (application ring) — orchestrates
  facts → generate → persist; pulls `container.repoIntel`, `container.git`,
  `container.llm(provider)`, `resolveFeatureModel`; owns the cost log and the
  degrade-never-throw contract. Never touches Drizzle directly.
- `server/src/modules/onboarding/facts.ts` (application ring — does I/O via
  `container.repoIntel`/`container.git`) + `helpers.ts` (pure domain: rank ordering, link
  building, skeleton assembly, path-allow-list filtering) + `constants.ts`.
- `server/src/modules/onboarding/generate.ts` (application ring) — the ONE
  `completeStructured` call and post-validation (enforce 5 kinds/order, drop non-architecture
  diagrams, filter links to real paths).
- `server/src/modules/onboarding/repository.ts` (infrastructure ring) — the only Drizzle
  file: workspace-scoped `getRepo`, and `getTour`/`upsertTour` on the `onboarding` table.
- Client: `client/src/app/repos/[repoId]/onboarding/page.tsx` is a thin `'use client'`
  entry → `_components/OnboardingView/` (the `'use client'` leaf holds all hooks/state);
  data logic lives in `client/src/lib/hooks/onboarding.ts`, never in JSX.

## Phased tasks

### Phase 0 — Contract first (blocks server writes + client parse)

- **T1 — Extend the `Onboarding` contract (two-copy vendored, lock-step)**
  - **Action:** In BOTH vendored copies, add four fields to the top-level `Onboarding`
    object (leave `sections`/`OnboardingSection`/`OnboardingLink` untouched):
    `generated_at: z.string().nullish()`, `files_indexed: z.number().int().nullish()`,
    `index_state: z.enum(['full','partial','degraded','failed']).nullish()`,
    `degraded_reason: z.string().nullish()`. All `.nullish()` for back-compat so
    already-persisted `onboarding.json` rows still `parse` (server INSIGHTS: a newly-required
    field on a persisted-document contract breaks reading old rows). Keep both files byte-identical.
  - **Package:** server + client
  - **Type:** core (shared contract)
  - **Owner:** orchestrator/human (vendored two-copy sync — never a parallel implementer)
  - **Skills to use:** zod, typescript-expert
  - **Owned paths:** `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** Editing one copy does NOT update the other — they are hand-synced.
    Both `vendor/shared/index.ts` already `export *` from `knowledge.js`, so no export edit needed.
  - **Acceptance:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both pass;
    the two files are identical (`diff` shows no delta) for the `Onboarding` block; the enum
    values are exactly `full|partial|degraded|failed`. Traces R11, R14, R19.

### Phase 1 — Server (implementer; all depend on T1)

- **T2 — Persistence: onboarding repository**
  - **Action:** Create `repository.ts` with a workspace-scoped `getRepo(workspaceId, repoId)`
    (mirror `context`/`conventions` repository), a `getTour(repoId): Promise<Onboarding | undefined>`
    that reads the `onboarding` row and `Onboarding.parse`es its `json`, and an
    `upsertTour(repoId, tour)` that `INSERT … ON CONFLICT (repoId) DO UPDATE` sets `json` +
    `generatedAt = now()`. All queries live only here.
  - **Package:** server
  - **Type:** backend
  - **Owner:** implementer
  - **Skills to use:** onion-architecture, drizzle-orm-patterns, typescript-expert
  - **Owned paths:** `server/src/modules/onboarding/repository.ts`
  - **Depends-on:** T1
  - **Known gotchas:** `onboarding` PK is `repoId` (no separate id) → upsert conflict target is
    `repoId`. ESM: relative imports carry `.js`. Parse-on-read must tolerate old rows (T1's
    `.nullish()` fields).
  - **Acceptance:** `cd server && pnpm typecheck` passes; `getTour` returns `undefined` for an
    un-generated repo and a parsed `Onboarding` for a generated one; `upsertTour` is idempotent
    on repeated calls (last-write-wins). Traces R1, R2, R3, R21.

- **T3 — Zero-LLM facts analyzer**
  - **Action:** Create `facts.ts` (I/O orchestration) + `helpers.ts` (pure) + `constants.ts`
    producing an internal `FactsBundle` from `container.repoIntel` + the clone only:
    (a) `getIndexState` → `status`/`degraded`/`reason` + `filesIndexed`; (b) stack/structure
    from `getRepoMap` + a **deterministic stack detector** built from `package.json`
    (dependencies/frameworks) read via `container.git.readFile`; (c) **package-scripts
    enumeration** from `package.json` `scripts`; (d) run-locally facts per **D1** — Node
    scripts + `.env.example` presence + `docker-compose*` presence (best-effort; generic
    "see the repo README" body when none); (e) `getTopFilesByRank` and `getFileRank` for the
    **reading-path ordered by descending rank (AC-6)**; (f) `getCriticalPaths`; (g)
    `getSymbolsInFiles` for top files to seed `first-tasks`. Emit an allow-list `Set<string>`
    of every real path seen (fuels the AC-9 link filter). No clone (`clonePath === null`),
    empty arrays, or degraded status must NEVER throw — return a partial bundle with markers.
    Pure transforms (rank sort, link building, path-allow-list, skeleton section assembly for
    all 5 kinds) live in `helpers.ts`.
  - **Package:** server
  - **Type:** backend
  - **Owner:** implementer
  - **Skills to use:** onion-architecture, typescript-expert
  - **Owned paths:** `server/src/modules/onboarding/facts.ts`, `server/src/modules/onboarding/helpers.ts`, `server/src/modules/onboarding/constants.ts`
  - **Depends-on:** T1
  - **Known gotchas:** repo-intel indexer only walks `.ts/.tsx/.js/.jsx/.mjs/.cjs`
    (`repo-intel/constants.ts` `SUPPORTED_EXT`) — a Laravel+Vue repo indexes "full" yet yields
    only `.ts` symbols/ranks; treat sparse facts as reduced-content, never fabricate `.php`/`.vue`
    (AC-13). Seeded `acme/payments-api` has `clonePath: null` and can never produce real intel
    (AC-11 no-clone case). `getIndexState` always works; array methods return `[]` when degraded.
    Reach intel ONLY via `container.repoIntel.*`.
  - **Acceptance:** `cd server && pnpm typecheck` passes; a unit test (`facts.test.ts`, unit lane)
    shows the bundle builds against a mocked `container.repoIntel`/`container.git` with (i) full
    data → populated bundle with reading-path sorted by descending rank, (ii) no-clone/degraded →
    partial bundle with a degraded marker and a non-empty path allow-list where any facts exist,
    and never throws. Traces R5, R6, R9, R11, R13.

- **T4 — The single LLM call + skeleton + post-validation**
  - **Action:** Create `skeleton.ts` (build the deterministic 5-section `Onboarding` skeleton
    from a `FactsBundle` — always all 5 kinds in fixed order, `first-tasks` present even when
    degraded per **D3**, sets `index_state`/`degraded_reason`/`files_indexed`) and `generate.ts`
    (the ONE `completeStructured` call: `renderPrompt('onboarding.system.md', { sections, language })`,
    the five kinds supplied as `{{sections}}`, all untrusted facts wrapped in `<untrusted>…</untrusted>`
    before reaching the prompt; a Zod output schema for the sections; return
    `{ onboarding, tokensIn, tokensOut, costUsd }`). Post-validate the model output: enforce the
    5 kinds + order (AC-7), null out any `diagram` on non-`architecture` sections (AC-8), and
    drop/omit any `OnboardingLink.path` not in the facts allow-list (AC-9). Align the template's
    inline `routes_and_apis` example wording to the 5 kinds (leave `{{sections}}` templating intact).
  - **Package:** server
  - **Type:** backend
  - **Owner:** implementer
  - **Skills to use:** onion-architecture, zod, security, mermaid-diagram, typescript-expert
  - **Owned paths:** `server/src/modules/onboarding/generate.ts`, `server/src/modules/onboarding/skeleton.ts`, `server/src/prompts/onboarding.system.md`
  - **Depends-on:** T1, T3
  - **Known gotchas:** `completeStructured` (not `complete()`) — the default `openrouter`
    provider stubs `complete()` to throw. `completeStructured` is non-deterministic even at
    `temperature:0`. Diagram field must be `null` (never `''`) for non-architecture kinds; keep
    Mermaid labels one-line/quoted per the template so they render.
  - **Acceptance:** `cd server && pnpm typecheck` passes; a unit test (`generate.test.ts`, unit
    lane) with a stub `LLMProvider` proves: (i) exactly one `completeStructured` invocation,
    (ii) sections normalized to the 5 kinds in order, (iii) a diagram supplied on `critical-paths`
    is nulled, (iv) a link with a path not in the allow-list is dropped, (v) skeleton builds with
    all 5 kinds from a degraded bundle. Traces R7, R8, R9, R10, R12, R15.

- **T5 — Service, routes, static registration**
  - **Action:** Create `service.ts` (`get(workspaceId, repoId)` → `getTour` or `undefined`,
    zero LLM; `recompute(workspaceId, repoId, logger)` → `getRepo` (not-found if wrong
    workspace) → `gatherFacts` → build skeleton → if index usable: `resolveFeatureModel(...,'onboarding')`
    → `container.llm(provider)` → ONE `generate()` → log
    `{ repoId, tokensIn, tokensOut, costUsd }` → merge narrative onto skeleton; on any LLM
    throw/unusable result: keep the skeleton and set `degraded_reason` → `upsertTour` → return.
    Never surface a 5xx for a degraded index or failed model call). Create `routes.ts`
    (`GET /repos/:id/onboarding` → `{ onboarding: Onboarding | null }`, zero LLM;
    `POST /repos/:id/onboarding/recompute` (empty body schema) → `{ onboarding: Onboarding }`),
    using `getContext` + `IdParams`. Add the one-line static registration to
    `server/src/modules/index.ts`.
  - **Package:** server
  - **Type:** backend
  - **Owner:** implementer
  - **Skills to use:** onion-architecture, fastify-best-practices, zod, security, typescript-expert
  - **Owned paths:** `server/src/modules/onboarding/service.ts`, `server/src/modules/onboarding/routes.ts`, `server/src/modules/index.ts`
  - **Depends-on:** T2, T3, T4
  - **Known gotchas:** modules are registered statically (no autoload) — the `index.ts` line is
    required or the routes 404. Follow Rec-1 envelope (`{ onboarding }`) so T7 matches. Cost is
    logged, not written to the row. Workspace scoping via `getContext` + repository `getRepo`
    (AC-21). Route param is `:id` per Rec-2.
  - **Acceptance:** `cd server && pnpm typecheck` and unit lane
    (`pnpm exec vitest run --exclude '**/*.it.test.ts'`) pass; routes appear in the registry.
    End-to-end proof of behavior is T6. Traces R1, R2, R3, R11, R12, R15, R21.

- **T6 — Server integration test (the AC proofs)**
  - **Action:** Add `onboarding.it.test.ts` (integration lane) using the real container +
    Postgres and a `ContainerOverrides.llm` **always-throwing** double to prove:
    (AC-1) `GET` on a repo with a persisted tour returns 200 with no LLM invocation;
    (AC-2) `GET` on a never-generated repo returns 200 with a null tour, no LLM call;
    (AC-3) `POST …/recompute` on a usable index issues exactly one `completeStructured` and
    upserts the row with a fresh `generatedAt`; (AC-11) recompute against the seeded
    `acme/payments-api` (`clonePath: null`) resolves to a persisted skeleton with
    `index_state` degraded/failed and non-empty `sections` — not a 5xx; (AC-12) with the
    throwing-LLM double, recompute still resolves to a skeleton marked degraded, not a 5xx;
    (AC-15) a recompute against a stub provider that returns token/cost emits one structured
    log line carrying `{ tokensIn, tokensOut, costUsd }`. Prove AC-1/AC-2 with the throwing
    double, NOT by grepping for the LLM call (server INSIGHTS: grep-for-LLM is fragile).
  - **Package:** server
  - **Type:** backend (integration test)
  - **Owner:** implementer (may be delegated to test-writer)
  - **Skills to use:** fastify-best-practices (`inject`), typescript-expert
  - **Owned paths:** `server/src/modules/onboarding/onboarding.it.test.ts`
  - **Depends-on:** T5
  - **Known gotchas:** integration files MUST end in `*.it.test.ts` (the unit lane excludes the
    glob and needs Docker for the DB). Inject the throwing/stub LLM via `ContainerOverrides.llm`
    (`container.ts:48`). `completeStructured` non-determinism → assert on structure/counts, not
    exact prose.
  - **Acceptance:** `cd server && pnpm exec vitest run .it.test` passes with the onboarding suite
    green (Docker up). Traces R1, R2, R3, R11, R12, R15.

### Phase 2 — Client (implementer; depend on T1)

- **T7 — Client data hooks**
  - **Action:** Create `client/src/lib/hooks/onboarding.ts` with `useOnboarding(repoId)`
    (`useQuery`, key `["onboarding", repoId]`, `api.get<{ onboarding: Onboarding | null }>(`/repos/${repoId}/onboarding`)`
    mapped to `.onboarding`, `enabled: !!repoId`) and `useRecomputeOnboarding(repoId)`
    (`useMutation`, `api.post<{ onboarding: Onboarding }>(`/repos/${repoId}/onboarding/recompute`, {})`,
    `onSuccess` writes `qc.setQueryData(["onboarding", repoId], data.onboarding)`). Mirror
    `blast.ts`; match the T5/Rec-1 envelope exactly.
  - **Package:** client
  - **Type:** ui
  - **Owner:** implementer
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `client/src/lib/hooks/onboarding.ts`
  - **Depends-on:** T1
  - **Known gotchas:** import the contract type from `@devdigest/shared`; import the hook file
    directly (no barrel). Keep the envelope in sync with T5 — if Rec-1 is switched to bare
    payload, update both.
  - **Acceptance:** `cd client && pnpm typecheck` passes; hook return types are `Onboarding | null`
    (query) / `Onboarding` (mutation). Traces R1, R3, R4.

- **T8 — i18n copy re-key**
  - **Action:** Update `client/messages/en/onboarding.json` so section labels/keys match the five
    `kind`s — `architecture`, `critical-paths`, `run-locally`, `reading-path`, `first-tasks` —
    and add UI strings for the empty-state "Generate" CTA, "Regenerating…", the degraded/
    "index unavailable" badge + reason, and the "last refreshed {relative}" + files-indexed
    header labels.
  - **Package:** client
  - **Type:** ui (copy)
  - **Owner:** implementer
  - **Skills to use:** frontend-architecture
  - **Owned paths:** `client/messages/en/onboarding.json`
  - **Depends-on:** none
  - **Known gotchas:** files under `messages/en/` are auto-discovered (`src/i18n/request.ts`) —
    no registration. Keep it valid JSON; the namespace consumed is `onboarding`.
  - **Acceptance:** valid JSON; keys exist for all five kinds + the new UI strings referenced by
    T9. Traces R14, R17, R19.

- **T9 — Repo-scoped tour page + components**
  - **Action:** Create `client/src/app/repos/[repoId]/onboarding/page.tsx` (thin `'use client'`
    entry rendering `<OnboardingView />`) and `_components/OnboardingView/` (the `'use client'`
    leaf): read `repoId` via `useParams<{repoId}>()`, call `useOnboarding`/`useRecomputeOnboarding`,
    and render: (AC-17) an empty state with a "Generate" CTA when the tour is null; (AC-4) a
    non-duplicable "Regenerating…" state (button disabled while the mutation is pending);
    (AC-18) each section `body` via the shared `Markdown` primitive and the `architecture`
    section's `diagram` via `MermaidDiagram` (invalid → renders nothing); (AC-14) a degraded
    badge + `degraded_reason` when `index_state !== 'full'`; (AC-19) a header showing
    `generated_at` as a relative "last refreshed" time and the `files_indexed` count (no
    hardcoded literals); (AC-20) each `OnboardingLink` as an actionable control resolving to
    the linked repo path. Colocate `helpers.ts`/`styles.ts` and a barrel `index.ts` per the
    `/context` `ProjectContextView` structure. All copy via `useTranslations('onboarding')`.
  - **Package:** client
  - **Type:** ui
  - **Owner:** implementer
  - **Skills to use:** next-best-practices, react-best-practices, frontend-architecture, mermaid-diagram, security, typescript-expert
  - **Owned paths:** `client/src/app/repos/[repoId]/onboarding/` (page.tsx + `_components/**`)
  - **Depends-on:** T1, T7, T8
  - **Known gotchas:** Next 15 — a repo-scoped `page.tsx` here is a `'use client'` component
    reading `useParams` (App Router); keep `'use client'` on the leaf, business logic in the
    hook not in JSX. Never `dangerouslySetInnerHTML` — the shared `Markdown` (react-markdown@9)
    already strips `javascript:`/dangerous schemes; do not add raw-HTML passthrough. Derive the
    relative time from `generated_at`, don't store it in state.
  - **Acceptance:** `cd client && pnpm typecheck` passes; manual/RTL (T10) confirms empty→Generate,
    degraded badge, staleness header, Markdown+Mermaid render. Traces R14, R17, R18, R19, R20.

- **T10 — Client component tests**
  - **Action:** Add RTL + Vitest tests colocated with `OnboardingView` covering the real
    user flows: (i) no tour → empty state renders and clicking "Generate" issues the recompute
    (MSW/mocked hook), (ii) tour with `index_state: 'degraded'` → degraded badge + reason shown,
    (iii) a persisted tour → relative "last refreshed" + files-indexed count render (no fixed
    literals) and section Markdown renders. 1–3 flow tests, query by role/text.
  - **Package:** client
  - **Type:** ui (test)
  - **Owner:** implementer (may be delegated to test-writer)
  - **Skills to use:** react-testing-library
  - **Owned paths:** `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.test.tsx`
  - **Depends-on:** T9
  - **Known gotchas:** wrap with the app's providers (React Query client, next-intl) as the
    `/context` test does; mock at the API/hook boundary, not the component.
  - **Acceptance:** `cd client && pnpm test` passes with the new suite green. Traces R14, R17, R19.

### Phase 3 — Vendored nav + e2e (orchestrator/human)

- **T11 — Add the "Onboarding Tour" nav entry (vendored)**
  - **Action:** Add `{ key: "onboarding", label: "Onboarding Tour", icon: <existing IconName>,
    href: "/repos/:repoId/onboarding", gKey: "o" }` to the WORKSPACE group in
    `client/src/vendor/ui/nav.ts` (pick an available `IconName` such as `Compass`/`Map`/`Route`,
    else a present fallback). Leave the existing `/onboarding` AddRepo route untouched.
  - **Package:** client
  - **Type:** ui (vendored nav)
  - **Owner:** orchestrator/human (vendored surface — not a parallel implementer)
  - **Skills to use:** frontend-architecture
  - **Owned paths:** `client/src/vendor/ui/nav.ts`
  - **Depends-on:** none
  - **Known gotchas:** `vendor/ui/nav.ts` is client-only here (no server mirror), but it is a
    vendored file → orchestrator owns it. `:repoId` in `href` is substituted by `resolveHref`.
    The `gKey` must not collide with an existing shortcut.
  - **Acceptance:** `cd client && pnpm typecheck` passes (valid `IconName`); the nav renders an
    "Onboarding Tour" item under WORKSPACE routing to `/repos/:repoId/onboarding`. Traces R16.

- **T12 — e2e flow (optional, deferrable)**
  - **Action:** If desired, add a deterministic e2e spec (open the tour page → Generate →
    sections render + degraded badge on an un-cloned repo). No AC mandates e2e; include only if
    the full stack is being exercised.
  - **Package:** e2e
  - **Type:** e2e
  - **Owner:** orchestrator/human (no pipeline agent owns e2e; needs the full stack running)
  - **Skills to use:** —
  - **Owned paths:** `e2e/specs/onboarding-tour.json` (or the repo's e2e spec convention)
  - **Depends-on:** T5, T9
  - **Risk:** low
  - **Known gotchas:** needs server + client + Postgres up; deterministic JSON spec only.
  - **Acceptance:** the e2e spec runs green against the live stack. Traces R16, R17 (end-to-end).

## Execution waves (multi-agent)
- **Wave A:** T1 (orchestrator/human) — unblocks everything.
- **Wave B (concurrent):** T2 ∥ T3 (server) ∥ T7 ∥ T8 (client) ∥ T11 (orchestrator/human) —
  all non-overlapping owned paths.
- **Wave C:** T4 (needs T3).
- **Wave D (concurrent):** T5 (needs T2,T3,T4) ∥ T9 (needs T1,T7,T8).
- **Wave E (concurrent):** T6 (needs T5) ∥ T10 (needs T9) ∥ T12 (needs T5,T9, optional).

## Testing strategy
- **Server unit** (no Docker): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  — `facts.test.ts` (T3) and `generate.test.ts` (T4) with mocked `container.repoIntel`/`container.git`
  and a stub `LLMProvider`.
- **Server integration** (Docker): `cd server && pnpm exec vitest run .it.test` —
  `onboarding.it.test.ts` (T6) with `ContainerOverrides.llm` throwing/stub doubles proving
  AC-1, AC-2, AC-3, AC-11, AC-12, AC-15.
- **Client**: `cd client && pnpm test` — `OnboardingView.test.tsx` (T10) flow tests; plus
  `cd client && pnpm typecheck` on every client task.
- **e2e** (optional, orchestrator/human): full-stack browser spec (T12).
- Planner runs none of these — each command is executed by the owning implementer.

## Risks & mitigations
- **LLM returns paths/symbols not in the facts (hallucination)** → T4 post-validation filters
  every `OnboardingLink.path` against the facts allow-list and nulls stray diagrams; grounding
  rules inherited from `onboarding.system.md` (AC-9).
- **Non-JS/TS repo indexes "full" but sparse** → T3 treats sparse facts as reduced-content,
  T4/T5 keep all 5 sections honest; no fabricated `.php`/`.vue` (AC-13). Covered by the INSIGHTS
  language-coverage note.
- **No-clone seeded repo (`acme/payments-api`)** → skeleton path in T4/T5, asserted by T6 (AC-11).
- **Envelope drift between server (T5) and client (T7)** → Rec-1 fixes the envelope; both tasks
  cite it; T6/T10 would catch a mismatch.
- **Registration forgotten** → routes 404 silently; T5 acceptance checks the registry, T6
  exercises the live routes.
- **Vendored copies drift** (T1 contract, T11 nav) → orchestrator/human owns both, edits in
  lock-step; `diff` check in T1 acceptance.
- **Prompt not copied to `dist` in a prod build** → known (`prompts.ts` note); dev via `tsx`
  needs no copy, so it does not block this plan.

## Red-flags check
- [x] Every requirement (AC-1…AC-21 → R1…R21) maps to at least one task (see per-task "Traces").
- [x] No specification was authored or edited — the spec is input; R-ids carry the AC-N keys.
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it (phases, DAG,
      non-overlapping owned paths, contract first).
- [x] Dependencies form a DAG (T1 → {T2,T3,T7,T8,T11}; T3 → T4; {T2,T3,T4} → T5; {T1,T7,T8} → T9;
      T5 → T6; T9 → T10; {T5,T9} → T12) — no cycles.
- [x] Concurrent tasks have non-overlapping Owned paths (Waves B and D verified;
      `server/src/modules/index.ts` touched only by T5; `nav.ts` only by T11).
- [x] Every Acceptance is measurable (a named command, a test assertion, or an observable check).
- [x] Vendored-contract (T1) and vendored-nav (T11) and e2e (T12) are owned by orchestrator/human,
      not a parallel implementer.
- [x] No tests or builds were run during planning.
