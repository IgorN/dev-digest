# Lens catalog

Per-skill cheat sheet for the review. Use it to brief a per-domain review
subagent, or as the high-signal checklist when you don't want to open every
`SKILL.md`. For each lens: **looks for** (what it reviews) and **CRITICAL signal**
(the finding from this lens that usually rises to critical — everything else from
the lens is High or below unless it produces a concrete production/security/build
failure). Always defer to the lens's own `SKILL.md` for depth.

## Cross-cutting (run on every code bucket)

### security (`.claude/skills/security/`) — OWASP Top 10:2025
- **Looks for:** injection (SQL/command/template), broken auth/authz, secret
  handling, unsafe file uploads, SSRF, XSS/sanitization, insecure deserialization,
  sensitive-data exposure in logs/responses.
- **CRITICAL signal:** any untrusted input reaching a sink without
  validation/escaping (SQLi, XSS, command injection); an auth/authz check that can
  be bypassed; a secret or token committed, logged, or returned in a response.

### general bug / correctness pass
- **Looks for:** logic errors, off-by-one, wrong/awaited-missing async, unhandled
  rejection, null/undefined deref, swallowed errors, wrong comparison, resource
  leaks, dead/contradictory code introduced by the diff.
- **CRITICAL signal:** a defect that crashes or corrupts on the happy path, or a
  change that breaks the build / type-checks red.

### typescript-expert (`.claude/skills/typescript-expert/`)
- **Looks for:** unsound types, `any`/`as` escape hatches hiding real errors,
  unsafe narrowing, public API typing.
- **CRITICAL signal:** a type hole that masks a runtime crash, or a change that
  won't compile.

### zod (`.claude/skills/zod/`)
- **Looks for:** request/response schemas, `safeParse` vs `parse` at boundaries,
  inference vs hand-written types, validation completeness.
- **CRITICAL signal:** user-controlled input crossing a trust boundary with no (or
  bypassable) zod validation — pairs with a security critical.

## Backend & domain (`server/**`, `reviewer-core/**`)

### onion-architecture (`.claude/skills/onion-architecture/`) — the domain-architecture lens
- **Looks for:** the dependency rule and layer placement — raw Drizzle/`db/schema`
  imported outside `repository.ts`; `process.env` or `new SomeAdapter()` in a
  service (must come off `container`); I/O inside `helpers.ts` / `reviewer-core`
  (pure core); business logic in a repository; HTTP shaping (`reply`/status) in a
  service; cross-module reach into a sibling's repository; hand-built error
  envelopes instead of typed throws. Its `references/violations.md` is the catalog.
- **CRITICAL signal:** a **repository query missing its `workspaceId` scope** —
  this is simultaneously an onion violation and a tenancy/data-leak security
  critical. Also: a secret read via `process.env` that leaks or bypasses secret
  invalidation. Most other onion findings are HIGH (maintainability/invariant),
  not critical.

### fastify-best-practices (`.claude/skills/fastify-best-practices/`)
- **Looks for:** route schema validation, plugin encapsulation, hook usage, error
  handling, serialization, async correctness in handlers.
- **CRITICAL signal:** an unvalidated route body/params that feeds a sink, or an
  unhandled async path that 500s/crashes the happy flow.

### drizzle-orm-patterns (`.claude/skills/drizzle-orm-patterns/`)
- **Looks for:** query construction, relations, transaction boundaries,
  parameterization, migration generation hygiene.
- **CRITICAL signal:** string-interpolated SQL (injection), or a write that should
  be transactional but isn't and can leave data half-written.

### postgresql-table-design (`.claude/skills/postgresql-table-design/`)
- **Looks for:** column types, nullability, constraints, indexes, foreign keys,
  uniqueness, migration safety.
- **CRITICAL signal:** a destructive migration (drop/rename/type-narrow) with no
  guard or backfill → data loss; a missing unique/FK that the new code's
  correctness depends on (e.g. a dedupe relying on `unique(workspaceId, name)`).

## Frontend (`client/**`)

### frontend-architecture (`.claude/skills/frontend-architecture/`) — UI structure/placement
- **Looks for:** where code lives — feature vs type folders, colocation, component
  splitting, placement of hooks/utils/lib/services/types, the `'use client'`
  boundary, App Router structure (`_components`, route groups, `src/`).
- **CRITICAL signal:** rarely critical on its own (it's a placement lens) — becomes
  critical only if a misplaced `'use client'`/server boundary leaks a secret or
  server-only code to the client bundle. Otherwise HIGH/MEDIUM.

### react-best-practices (`.claude/skills/react-best-practices/`)
- **Looks for:** hooks rules, state anti-patterns, effect misuse, key/list bugs,
  unnecessary re-renders, data-fetching patterns.
- **CRITICAL signal:** a hooks-rules violation or effect bug that breaks render on
  the happy path; an effect that fires an unguarded destructive call.

### next-best-practices (`.claude/skills/next-best-practices/`)
- **Looks for:** RSC vs client boundaries, async APIs, data fetching/caching,
  metadata, route handlers, image/font optimization.
- **CRITICAL signal:** server-only data/secret exposed across the client boundary,
  or a route handler leaking unauthorized data.

### react-testing-library (`.claude/skills/react-testing-library/`) — on `*.test.tsx`
- **Looks for:** query priority, `userEvent` usage, async/`findBy` patterns,
  mocking strategy, anti-patterns (testing implementation details).
- **CRITICAL signal:** essentially none — test-quality findings are MEDIUM/LOW.
  A test that asserts nothing (false green) covering new critical logic is HIGH.

## Calibration reminder
A lens flagging something is not automatically critical. Map every finding through
the SKILL.md severity rubric by **impact if merged**. The reliable criticals come
from `security`, the general bug pass, missing-tenancy (onion), and destructive
migrations (postgres) — verify those before trusting them; treat most pure
architecture/convention findings as High or below.
