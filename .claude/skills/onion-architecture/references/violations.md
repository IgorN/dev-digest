# Onion violations — anti-pattern catalog

Each entry: **symptom → why it breaks the dependency rule → before/after**. Use
this when reviewing a backend PR or diagnosing a layering smell. The fixes move
code *inward across one ring*, never the other way.

---

## 1. Raw SQL / Drizzle in a route

**Symptom:** `routes.ts` imports `drizzle-orm` or `db/schema`, or builds a query.

**Why it breaks the rule:** transport (outer) reaches straight into persistence
(infrastructure), skipping the service and repository rings. Now the HTTP handler
can't be tested without a database, and the query isn't workspace-scoped in one
auditable place.

```ts
// ✗ before — routes.ts
app.get('/repos', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return app.container.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
});
```
```ts
// ✓ after — routes.ts delegates; the query lives in repository.ts via service
app.get('/repos', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.list(workspaceId);            // service → repo.list() → Drizzle
});
```

---

## 2. `process.env` (or `new SomeAdapter()`) inside a service

**Symptom:** a service reads `process.env.GITHUB_TOKEN`, or does
`new GitClient(...)` / `new OpenAI(...)`.

**Why it breaks the rule:** the application ring binds itself to a concrete
implementation and to the runtime environment, defeating dependency inversion.
Tests can no longer swap the adapter via `ContainerOverrides`, and secret caching
/ invalidation is bypassed.

```ts
// ✗ before — service.ts
const token = process.env.GITHUB_TOKEN;
const git = new GitClient();
```
```ts
// ✓ after — service.ts pulls the interface off the container
const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
const { path } = await this.container.git.clone({ owner, name }, cloneUrl, { depth: CLONE_DEPTH });
```

---

## 3. I/O inside a helper / `reviewer-core`

**Symptom:** a function in `helpers.ts` (or `reviewer-core`) `await`s a DB call,
an HTTP request, the filesystem, or touches `container`.

**Why it breaks the rule:** the domain core is supposed to be the one ring with
*no* dependencies — pure in, pure out. Smuggling I/O in makes it untestable in
isolation and couples the core to infrastructure.

```ts
// ✗ before — helpers.ts
export async function toRepoDto(id: string) {
  const row = await db.select().from(t.repos).where(eq(t.repos.id, id));  // I/O in a "helper"
  return { id: row.id, /* ... */ };
}
```
```ts
// ✓ after — helper is pure; the service fetches the row and passes it in
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return { id: row.id, full_name: row.fullName, /* ... */ };
}
// service.ts: const row = await this.repo.getById(workspaceId, id); return toRepoDto(row);
```

---

## 4. Business logic in the repository

**Symptom:** `repository.ts` decides *what should happen* — enqueues jobs,
branches on business rules, calls other adapters, throws domain errors like
`NotFoundError`.

**Why it breaks the rule:** the repository is pure persistence (infrastructure).
Mixing orchestration in means the same decision can't be reused or tested apart
from SQL, and the "swap the ORM touches only this file" guarantee is lost.

```ts
// ✗ before — repository.ts
async addRepo(workspaceId, url) {
  const { owner, name } = parseRepoUrl(url);                 // business
  const existing = await this.findByFullName(workspaceId, `${owner}/${name}`);
  if (existing) throw new ValidationError('already exists'); // policy
  const row = await this.insert({ /* ... */ });
  await this.jobs.enqueue(workspaceId, 'clone', { /* ... */ }); // orchestration
  return row;
}
```
```ts
// ✓ after — repository only persists; the service orchestrates
// repository.ts
async insert(values: InsertRepo): Promise<RepoRow> { /* Drizzle insert */ }
async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> { /* ... */ }
// service.ts owns parseRepoUrl, the dedupe decision, and jobs.enqueue
```

---

## 5. HTTP shaping leaking inward (`reply` / status codes in a service)

**Symptom:** a service takes the Fastify `reply`, sets a status code, or returns
a `{ statusCode, body }` shape.

**Why it breaks the rule:** the application ring shouldn't know it's behind HTTP.
Coupling to `reply` makes the use-case unusable from a job, a CLI, or a test
without faking the HTTP layer.

```ts
// ✗ before — service.ts
async add(reply, workspaceId, url) {
  /* ... */
  reply.status(created ? 201 : 200);     // HTTP concern in the service
  return repo;
}
```
```ts
// ✓ after — service returns data + a flag; the route maps the status
// service.ts → returns { repo, created }
// routes.ts:
const { repo, created } = await service.add(workspaceId, userId, req.body.url);
reply.status(created ? 201 : 200);
return repo;
```

---

## 6. Hand-built error envelope instead of a typed throw

**Symptom:** a route or service builds `reply.status(404).send({ error: ... })`
by hand instead of throwing a typed error.

**Why it breaks the rule:** duplicates the boundary's job and drifts from the
stable `{ error: { code, message, details } }` contract. The central error
handler already serializes typed errors.

```ts
// ✗ before
if (!repo) return reply.status(404).send({ error: { code: 'not_found', message: 'Repo not found' } });
```
```ts
// ✓ after — throw; the boundary serializes
if (!repo) throw new NotFoundError('Repo not found');
```

---

## 7. Cross-module reach-around (importing another module's repository)

**Symptom:** `modules/reviews/service.ts` imports
`modules/repos/repository.ts` directly, or touches another module's tables.

**Why it breaks the rule:** modules are vertical slices; reaching into a
sibling's infrastructure couples them and bypasses that module's invariants
(e.g. its workspace scoping). Go through the shared seam instead — the
`container` (`container.repoIntel.*`) or that module's service.

```ts
// ✗ before — reviews/service.ts
import { RepoRepository } from '../repos/repository.js';
const repos = new RepoRepository(this.container.db);
```
```ts
// ✓ after — reach the capability through the container's interface
const map = await this.container.repoIntel.getRepoMap(repoId);   // owned seam
```

---

## Quick review checklist

Run down this list against a backend diff:

- [ ] No `drizzle-orm` / `db/schema` import outside `repository.ts` / `*.repo.ts`.
- [ ] No `process.env` in modules — secrets/config via `container`.
- [ ] No adapter `new`-ed in a route or service — pulled off `container`.
- [ ] `helpers.ts` / `reviewer-core` contain zero `await` on I/O.
- [ ] Repository methods are intention-named and return rows/DTOs, not query builders.
- [ ] Every repository query is workspace-scoped (or a comment says why not).
- [ ] Errors are typed throws, not hand-built envelopes; no `reply`/status in services.
- [ ] No import from a sibling module's `repository.ts` — go through `container`.
