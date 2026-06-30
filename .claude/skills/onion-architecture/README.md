# Onion Architecture — skill plan (living doc)

Draft / planning notes for the `onion-architecture` skill. This is the **idea
bucket**: we keep extending it here, then distill into `SKILL.md`.

## Locked decisions
- **Enforcement: guidance-only.** SKILL.md + references + decision-tree + review
  checklist. No bundled lint config / no CI rules. Claude applies the rules on
  the fly while writing or reviewing backend modules.
- **Scope: the existing 3-layer layout.** Codify what already exists
  (`routes → service → repository → helpers` + `reviewer-core` as the pure core),
  expressed in onion terms. Do NOT import foreign boilerplate (InversifyJS,
  decorator DI, separate `domain/entities/` rings).

## Core insight
The backend is **already onion-shaped**, just not named so. Each feature module
under `server/src/modules/` is `routes → service → repository → helpers`;
`reviewer-core` is a pure no-I/O core; `container` is the DI / composition root.
The skill's job is to **name, codify, and defend** these conventions — not to
restructure the codebase.

## Goal & trigger
- **Does:** when creating/editing a backend module, enforces onion's dependency
  rule and the layer layout; when reviewing, flags violations (SQL in a route,
  `process.env` in a service, Drizzle import in `helpers`, business logic in a
  repository).
- **Triggers on (be "pushy" in `description`):** creating a module under
  `server/src/modules/`, adding routes/service/repository, refactoring layers,
  "where should this logic live", decoupling the DB, backend PR review. Keywords:
  onion, layering, dependency rule, clean architecture, DDD.

## Layer map — bound to OUR files (the heart of the skill)

| Onion ring         | Where it lives                                  | May depend on                         | Forbidden                                  |
|--------------------|-------------------------------------------------|---------------------------------------|--------------------------------------------|
| Domain core        | `reviewer-core/src/`                            | nothing (pure functions)              | DB, HTTP, fs, network, secrets             |
| Domain helpers     | `modules/*/helpers.ts`, `findings.ts`           | core, types                           | any I/O                                     |
| Application / use-cases | `modules/*/service.ts`, `run-executor.ts`  | repositories & adapters via `container` | Drizzle directly, `process.env`, Fastify req/reply |
| Infrastructure     | `modules/*/repository*.ts`, `platform/*`        | DB, external APIs                      | business rules                             |
| Transport (outer)  | `modules/*/routes.ts`                           | service, zod contracts                | raw SQL, business decisions                |

## Invariants the skill enforces (dependency rule → checkable rules)
1. **Dependencies point inward.** `routes → service → repository`; nothing imports outward.
2. **Core has no side effects.** `reviewer-core` and `helpers.ts` do no I/O
   (already stated in `reviewer-core/CLAUDE.md`).
3. **Decouple via interfaces + DI.** Adapters come off `container`, never `new`-ed
   in routes; secrets only via `container.secrets`. This is onion's DIP.
4. **Repository hides the technology.** Service never touches Drizzle; persistence
   and workspace-scoping live in `*.repo.ts`.
5. **Contracts (zod / `@devdigest/shared`)** stay at the transport boundary.

## Skill file structure
```
onion-architecture/
├── SKILL.md                  # dependency rule + layer table + "where does this code go" decision-tree + review checklist
├── README.md                 # THIS living plan
├── references/
│   ├── layer-map.md          # detailed layer→file map with examples from reviews/agents/repos
│   ├── violations.md         # anti-pattern catalog "before → after" (SQL in route, env in service, ...)
│   └── new-module-recipe.md  # step-by-step: the 5 module files + one line in modules/index.ts
└── assets/
    └── module-template/      # routes/service/repository/helpers/constants.ts stub
```
- Keep SKILL.md < 500 lines: rule + table + decision-tree + pointers to references.
- **Decision-tree is the highest-value piece:** "Business decision? → service.
  DB query? → repository. Pure transform, no I/O? → helpers. Request parsing? → routes."

## Deliberately NOT doing
- No InversifyJS / decorator DI — `container` already does this.
- No separate `domain/entities/` rings — would break the "5 files per module" shape.
- No dogma: onion is worth only as much as it buys testability. Trivial modules
  (e.g. `settings/` = routes → DB directly) may skip the service layer; the skill
  must permit that simplification, not demand an empty service.

## Ground truth (verified against the code)
- Typical module = 5 files: `routes.ts`, `service.ts`, `repository.ts`,
  `helpers.ts`, `constants.ts`. Complex modules add sub-repos (`repository/*.repo.ts`).
- DI: `server/src/platform/container.ts` — lazy getters, `ContainerOverrides` for
  test mocks. Attached via `app.decorate('container', container)`.
- Module registry: `server/src/modules/index.ts` — static map; add a module =
  new folder + one import + one entry. (Static, not autoload, so the same path
  works under tsx / bundler / vitest.)
- Errors: `platform/errors.ts` (`AppError`/`NotFoundError`/`ValidationError`/...),
  caught centrally in `app.ts` → structured JSON envelope.
- Workspace scoping: `getContext()` in `_shared/context.ts`; repos always scope by
  `workspaceId`.
- Pure core: `reviewer-core` exports `reviewPullRequest`, `assemblePrompt`,
  `groundFindings`, ... — no DB/GitHub/fs, LLM only via injected `LLMProvider`.

## Build status
- [x] `SKILL.md` — dependency rule + layer table + decision-tree + 5 invariants + checklist.
- [x] `references/layer-map.md` — ring→file with annotated real snippets (repos/agents/reviews).
- [x] `references/violations.md` — 7 anti-patterns (before→after) + review checklist.
- [x] `references/new-module-recipe.md` — scaffolding steps.
- [x] `assets/module-template/` — 5 `.ts.template` stubs (routes/service/repository/helpers/constants).

## Next steps
1. Eval: 2-3 realistic prompts ("add a `labels` module", "review this route that
   queries the DB directly", "where should X live"). Run with/without skill, review.
2. Optimize `description` for triggering accuracy.

## References (external best practices)
- Onion Architecture in Node.js with TypeScript & InversifyJS — https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad
- Clean Architecture with TypeScript: DDD, Onion (Bazaglia) — https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/
- Onion Architecture in DDD — https://dev.to/yasmine_ddec94f4d4/onion-architecture-in-domain-driven-design-ddd-35gn
- Clean vs Onion vs Hexagonal — https://code-maze.com/dotnet-differences-between-onion-architecture-and-clean-architecture/
- DDD, Hexagonal, Onion, Clean, CQRS — how it fits together (herbertograca) — https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/
