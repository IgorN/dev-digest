---
name: onion-architecture
description: >-
  Enforces Onion Architecture (the dependency rule + layered separation) for
  DevDigest backend feature modules under server/src/modules/. Use this WHENEVER
  you create or edit a backend module, add or change a route / service /
  repository / helper, decide "where should this logic live", wire database or
  external-service access, or review a backend PR for layering. Also use when the
  user mentions onion architecture, clean architecture, layering, the dependency
  rule, separation of concerns, decoupling the database, or DDD on the server.
  Map each ring to the project's real files, keep the domain core free of I/O,
  and route all adapters through `container`. Reach for it even when the user
  doesn't say "onion" but is clearly placing backend code across HTTP, business
  logic, and persistence.
---

# Onion Architecture (DevDigest backend)

The DevDigest backend is **already onion-shaped** — it just doesn't say so out
loud. Each feature module under `server/src/modules/` is layered
`routes → service → repository → helpers`; `reviewer-core` is a pure no-I/O core;
`container` is the composition root that injects every adapter. Your job is to
**name, keep, and defend** that shape — not to restructure the code or import
foreign boilerplate (no InversifyJS, no decorator DI, no separate
`domain/entities/` rings).

Onion buys exactly one thing: **the inner rings never know about the outer ones**,
so business logic stays testable without a database, an HTTP server, or a live
LLM. Every rule below exists to protect that property. When a rule would force
ceremony that buys no testability (see *Pragmatic exceptions*), skip it.

## The dependency rule (the one rule everything else serves)

Dependencies point **inward only**. An outer ring may import an inner ring; an
inner ring must never import an outer one.

```
   routes.ts  ─────────▶  service.ts  ─────────▶  repository.ts / adapters
  (transport)            (application)            (infrastructure)
       │                      │                         │
       └──────────────────────┴────────▶  helpers.ts / reviewer-core
                                              (pure domain core)
```

Concretely in this codebase: `routes` import `service`; `service` imports
`repository` and reaches adapters off `container`; `repository` imports Drizzle;
`helpers` and `reviewer-core` import nothing with I/O. Nobody imports "up" the
arrow.

## Layer map — onion ring → your real files

| Ring | Lives in | May depend on | Never contains |
|------|----------|---------------|----------------|
| **Domain core** | `reviewer-core/src/`, `modules/*/helpers.ts`, `modules/*/findings.ts` | other pure code, types, contracts | DB, HTTP, fs, network, secrets, `container` |
| **Application / use-cases** | `modules/*/service.ts`, `modules/*/run-executor.ts` | repositories + adapters **via `container`**, helpers, errors | raw Drizzle, `process.env`, Fastify `req`/`reply`, status codes |
| **Infrastructure** | `modules/*/repository.ts`, `modules/*/repository/*.repo.ts`, `platform/*` adapters | Drizzle, external SDKs/clients | business rules, HTTP shaping |
| **Transport (outer edge)** | `modules/*/routes.ts` | the module's `service`, zod contracts, `getContext` | raw SQL, business decisions, direct adapter `new`-ing |

The canonical, by-the-book example is the **`repos` module** — read those four
files when in doubt: [routes.ts](../../../server/src/modules/repos/routes.ts) ·
[service.ts](../../../server/src/modules/repos/service.ts) ·
[repository.ts](../../../server/src/modules/repos/repository.ts) ·
[helpers.ts](../../../server/src/modules/repos/helpers.ts).

## "Where does this code go?" — decision tree

Ask these in order; stop at the first yes:

1. **Is it parsing/validating the HTTP request, mapping a status code, or shaping
   the response envelope?** → `routes.ts`. Validate the body/params with a zod
   contract (`{ schema: { body, params } }`), pull tenancy via
   `getContext(app.container, req)`, then delegate. No `if`-heavy logic here.
2. **Is it a direct database read/write (a Drizzle query)?** → `repository.ts`
   (or a `*.repo.ts` sub-repo for a large module). Every query is
   **workspace-scoped** (`and(eq(t.x.workspaceId, …), …)`) unless a comment
   justifies why not. This is the only place that imports `drizzle-orm` or
   `db/schema`.
3. **Is it a business decision, an orchestration/workflow, or a call to an
   external adapter (git, GitHub, LLM, jobs, secrets, runBus)?** → `service.ts`.
   Pull adapters off `container` (`this.container.git`, `this.container.jobs`,
   `this.container.secrets.get(...)`). Never `new` an adapter here and never read
   `process.env`.
4. **Is it a pure transform — DTO mapping, URL parsing, a format conversion, a
   calculation — with no I/O?** → `helpers.ts` (or `reviewer-core` if it's part
   of the review engine). Pure in, pure out. If it `await`s I/O, it doesn't
   belong here.
5. **Is it a literal, magic number, secret name, or regex?** → `constants.ts`.

## The five invariants (what to enforce and flag)

These are the dependency rule made checkable. When writing, satisfy them; when
reviewing, flag violations with the fix.

1. **Dependencies point inward.** `routes → service → repository`; no inner file
   imports an outer one. A `repository.ts` importing from `routes.ts`, or a
   `helpers.ts` importing `service.ts`, is a layering inversion.
2. **The core has no side effects.** `reviewer-core` and `helpers.ts` do zero
   I/O — no DB, no network, no fs, no `container`, no `process.env`. If a "helper"
   needs to `await` something external, it's a service method, not a helper.
3. **Decouple through `container` + interfaces (DIP).** Services depend on the
   adapter *interfaces* the container exposes (`GitClient`, `LLMProvider`,
   `JobRunner`, `SecretsProvider`); they don't construct concrete adapters.
   Routes never `new` adapters either — they construct the module's service and
   delegate. This is what lets tests inject mocks via `ContainerOverrides`.
4. **The repository hides the persistence technology.** Services never see
   Drizzle. They call intention-named repository methods (`findByFullName`,
   `updateClonePath`) and receive row types or DTOs — not query builders. Swapping
   the ORM should touch only `repository.ts`.
5. **Secrets and config cross the boundary through the container, never directly.**
   `container.secrets.get('GITHUB_TOKEN')`, never `process.env.GITHUB_TOKEN`.
   After a Settings change, call `container.invalidateSecretCaches()`.

## Errors cross layers as typed domain errors

Throw the typed errors from [`platform/errors.ts`](../../../server/src/platform/errors.ts)
(`NotFoundError`, `ValidationError`, `ExternalServiceError`, `ConfigError`, or a
raw `AppError(code, message, status)`) from the **service** (or helpers, for pure
validation like `parseRepoUrl`). The central Fastify error handler maps them to
the structured `{ error: { code, message, details } }` envelope. Routes should
**not** hand-build error responses or `reply.status(500)` — throw and let the
boundary serialize. This keeps HTTP-shaping out of the inner rings.

## Pragmatic exceptions (don't add ceremony that buys nothing)

Onion is worth only as much testability as it buys. Do **not** mechanically
demand all five files:

- **Trivial CRUD with no business rules** may collapse the service — e.g.
  `settings/` goes routes → DB directly. Don't invent an empty pass-through
  `service.ts` that only forwards calls; that's ceremony, not a layer.
- **A tiny module** may keep helpers/constants inline until there's a second
  user. Extract when duplication or size justifies it (the `repos` helpers were
  extracted *out of* routes once they grew).
- **Large modules** split the repository into sub-repos (`reviews/repository/`
  has `review.repo.ts`, `run.repo.ts`, `pull.repo.ts`) and may add focused files
  like `run-executor.ts` (a long-running use-case) — still application-ring, still
  no raw HTTP. More files, same rule.

The test for an exception: *does collapsing this layer make the business logic
harder to unit-test?* If no, collapsing is fine. If yes, keep the layer.

## When creating a new module

A feature module is a Fastify plugin registered **statically** in
[`modules/index.ts`](../../../server/src/modules/index.ts) (no autoload). The
recipe — the five files, the default-export plugin shape, and the one-line
registry edit — is in
[`references/new-module-recipe.md`](references/new-module-recipe.md), with a
copy-paste skeleton under [`assets/module-template/`](assets/module-template/).

## References

Read the matching file when you need depth — don't inline it all here:

- **[references/layer-map.md](references/layer-map.md)** — the layer→file map in
  full, with annotated real snippets from `repos`, `agents`, and `reviews`. Read
  when you're unsure which ring a piece of code belongs to.
- **[references/violations.md](references/violations.md)** — anti-pattern catalog,
  each as *symptom → why it breaks the dependency rule → before/after fix*. Read
  when reviewing a backend PR or diagnosing a smell.
- **[references/new-module-recipe.md](references/new-module-recipe.md)** —
  step-by-step for scaffolding a new module the onion way. Read when adding a
  feature folder.
