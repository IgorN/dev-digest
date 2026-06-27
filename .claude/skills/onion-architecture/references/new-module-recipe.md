# New module recipe (the onion way)

Scaffolding a new backend feature module so it satisfies the dependency rule from
the start. A module is a **vertical slice** — its own routes/service/repository,
registered statically. Mirror the `repos` module; copy the stubs in
[`../assets/module-template/`](../assets/module-template/) and rename.

## Step 0 — decide the layers you actually need

Don't reflexively create all five files. Use the *testability* test:

- Pure CRUD, no business rules → routes + repository may be enough (collapse the
  service, like `settings/`).
- Any decision, orchestration, external adapter, or async job → you need a
  service.
- Pure transforms / DTO mapping → helpers (extract once it grows; inline is fine
  at first).
- Literals, secret names, regexes → constants.

## Step 1 — create the folder and the five files

```
server/src/modules/<name>/
├── routes.ts        # transport: zod-validated, delegates to the service
├── service.ts       # application: decisions, orchestration, adapters via container
├── repository.ts    # infrastructure: the ONLY place touching this module's tables
├── helpers.ts       # domain core: pure transforms, no I/O   (optional at first)
└── constants.ts     # literals / magic numbers / secret names  (optional at first)
```

Naming: lowercase folder = the feature; ESM relative imports carry the `.js`
extension (`./service.js`). Row type: `export type XRow = typeof t.x.$inferSelect`
in the repository.

## Step 2 — write each ring (inner → outer)

Build inward-out so the inner rings exist before the outer ones import them:

1. **repository.ts** — methods you need, each workspace-scoped, returning rows.
2. **helpers.ts / constants.ts** — pure transforms + literals, if any.
3. **service.ts** — `constructor(private container: Container)`; build the repo
   from `container.db`; orchestrate using repo + helpers + `container.*` adapters.
   Throw typed errors from `platform/errors.ts`. Return data + flags, not HTTP.
4. **routes.ts** — `export default async function <name>Routes(appBase)`; get the
   typed app, construct the service, register routes with
   `{ schema: { body, params } }` zod contracts, resolve `getContext`, delegate,
   map status codes.

## Step 3 — register it statically

One import + one entry in [`modules/index.ts`](../../../../server/src/modules/index.ts).
No filesystem autoload (the static map is what keeps tsx / bundler / vitest on the
same code path).

```ts
import labels from './labels/routes.js';        // 1. import

export const modules: Record<string, FastifyPluginAsync> = {
  settings, repos, pulls, polling, workspace, agents, reviews, repoIntel,
  labels,                                        // 2. register
};
```

## Step 4 — verify the boundaries hold

Before you're done, run the checklist from
[`violations.md`](violations.md#quick-review-checklist) against your diff. The two
that bite most often:

- No `drizzle-orm` import outside `repository.ts`.
- No `process.env` / `new SomeAdapter()` in the service — everything via
  `container`.

## Step 5 — schema changes, if any

New tables/columns are a separate, deliberate step (migrations are **not** applied
on boot): edit `db/schema/*.ts` → `pnpm db:generate` → `pnpm db:migrate`. Never
hand-author the generated SQL.

## Testing the slice

Because the rings are decoupled, you can test each in isolation:

- **helpers / reviewer-core** — call directly, no setup.
- **service** — construct with a `Container` whose adapters are mocked via
  `ContainerOverrides`; assert decisions and the calls made to `container.*`.
- **repository** — integration test (`*.it.test.ts`, Docker) against a real DB.
- **routes** — through Fastify `inject`, asserting status + envelope.
