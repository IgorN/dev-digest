# Layer map — ring → file, with annotated real snippets

The full mapping behind the SKILL.md table, grounded in real code. Read when
you're unsure which ring a piece of code belongs to. The `repos` module is the
canonical four-layer example; `agents` mirrors it; `reviews` shows how a large
module scales the same rules.

## Ring 0 — Domain core (no dependencies, no I/O)

**Files:** `reviewer-core/src/*`, `modules/*/helpers.ts`, `modules/*/findings.ts`,
`modules/*/constants.ts`.

Pure functions and literals. Imports types/contracts only — never `container`,
`db`, a network client, or `fs`. This is the ring you can unit-test with no
setup.

```ts
// modules/repos/helpers.ts — pure in, pure out
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const match = url.match(GITHUB_URL_REGEX);
  if (!match?.[1] || !match[2]) {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
  }
  return { owner: match[1], name: match[2] };
}

// Map a persisted row to the API DTO — takes the row as input, does no fetching
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return { id: row.id, full_name: row.fullName, /* ... */ };
}
```

Throwing a typed `AppError` from a pure validator is fine — it's a value, not
I/O. `reviewer-core` is the same idea at package scale: `reviewPullRequest`,
`assemblePrompt`, `groundFindings` take inputs and an injected `LLMProvider` and
return results; no DB, GitHub, or filesystem.

## Ring 1 — Infrastructure (persistence + adapters)

**Files:** `modules/*/repository.ts`, `modules/*/repository/*.repo.ts`, the
adapters under `platform/*`.

The only place that imports `drizzle-orm` / `db/schema`. Methods are
intention-named, every query is workspace-scoped, and they return row types or
DTOs — never a query builder. No business rules, no orchestration, no HTTP.

```ts
// modules/repos/repository.ts — "the ONLY place that touches the repos table"
export class RepoRepository {
  constructor(private db: Db) {}

  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;                              // workspace-scoped; returns a row, not a query
  }

  async insert(values: InsertRepo): Promise<RepoRow> { /* Drizzle insert ... */ }
}
```

Large modules split this ring by aggregate but keep the rule:
`reviews/repository/` → `review.repo.ts`, `run.repo.ts`, `pull.repo.ts`, composed
by a thin `reviews/repository.ts` facade.

## Ring 2 — Application / use-cases (orchestration + decisions)

**Files:** `modules/*/service.ts`, plus focused use-case files like
`modules/reviews/run-executor.ts`.

Holds the business decisions and the workflow. Pulls every adapter off
`container` (never `new`s one, never reads `process.env`). Calls the repository
for persistence and helpers for pure transforms. Knows nothing about Fastify
`req`/`reply` or status codes.

```ts
// modules/repos/service.ts
export class RepoService {
  private repo: RepoRepository;
  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);     // the repo is the service's own infra
  }

  async add(workspaceId: string, userId: string, url: string): Promise<{ repo: Repo; created: boolean }> {
    const { owner, name } = parseRepoUrl(url);                       // helper (pure)
    const fullName = `${owner}/${name}`;
    const existing = await this.repo.findByFullName(workspaceId, fullName);  // repo (infra)
    if (existing) return { repo: toRepoDto(existing), created: false };       // decision
    const row = await this.repo.insert({ workspaceId, owner, name, fullName, createdBy: userId });
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, { /* ... */ }); // adapter via container
    return { repo: toRepoDto(row), created: true };
  }
}
```

Note what's *absent*: no SQL, no `reply`, no `process.env`, no `new GitClient()`.
The `{ repo, created }` return lets the route choose 200 vs 201 — HTTP stays out.

## Ring 3 — Transport (the outer edge)

**File:** `modules/*/routes.ts` — a default-exported Fastify plugin.

Parses/validates the request (zod contract in `{ schema: { body, params } }`),
resolves tenancy via `getContext`, delegates to the service, and maps the status
code / response. No business logic, no SQL.

```ts
// modules/repos/routes.ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);     // construct the use-case, inject the container
  service.registerCloneJobHandler();

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);  // tenancy
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);                // status mapping is a transport concern
    return repo;
  });
}
```

## The composition root — `platform/container.ts`

Not a ring; the seam that wires rings together at runtime. Lazy getters expose
adapter *interfaces* (`git`, `github`, `jobs`, `runBus`, `secrets`, `auth`,
`repoIntel`, `llm(...)`); `ContainerOverrides` lets tests inject mocks. This is
what makes the dependency inversion real: services name an interface, the
container decides the concrete implementation.

```ts
get repoIntel(): RepoIntel {
  if (this.overrides.repoIntel) return this.overrides.repoIntel;  // test mock wins
  this._repoIntel ??= new RepoIntelService(this);                 // lazy concrete
  return this._repoIntel;
}
```

Attached to Fastify once (`app.decorate('container', container)`), so every route
reads `app.container`. Cross-module capabilities are reached **only** through it
(e.g. `container.repoIntel.*`), never by importing a sibling module's repository.

## Where shared, cross-cutting pieces live

| Concern | Home | Reached from |
|---------|------|--------------|
| Tenancy context | `modules/_shared/context.ts` (`getContext`) | routes |
| Typed errors / envelope | `platform/errors.ts` | thrown in services/helpers, serialized at the boundary |
| API contracts (zod) | `@devdigest/shared` (vendored) | route `schema`, DTO types |
| DI / adapters | `platform/container.ts` + `platform/*` | services via `this.container.*` |
| Module registry | `modules/index.ts` (static map) | startup |
