---
name: pr-self-review
description: >-
  Local pre-PR gate for DevDigest. Reviews ALL pending changes (the working-tree
  diff + commits not yet on the base branch) by routing each changed file to the
  project's own domain skills as review lenses — frontend files through the UI
  architecture/React/Next skills, backend & reviewer-core files through the
  onion-architecture and Fastify/Drizzle/Postgres skills — plus a general
  bug-correctness and OWASP-security pass, then aggregates findings by severity
  and BLOCKS if any CRITICAL is found. Use this WHENEVER the user is about to push,
  open / create a pull request, or asks to "self-review", "review my changes /
  diff before I open a PR", "check my changes locally", "is this ready for a PR",
  or runs a pre-push check. Reach for it even when the user just says "I'm about to
  push" or "can you look over my diff" without naming a review — the whole point is
  to catch problems locally before the PR exists.
---

# PR Self-Review (local pre-PR gate)

Catch problems **before** the pull request exists. This skill is an orchestrator:
it doesn't re-derive review rules itself — it figures out what changed, routes
each file to the project's own domain skills (the ones in `.claude/skills/`) as
review *lenses*, adds a general bug + security pass, then aggregates everything
into one severity-ranked report with a single verdict. **One CRITICAL finding →
BLOCK** (don't push / don't open the PR until it's fixed).

The value is leverage: every lens is a skill the team already maintains, so the
review stays consistent with how the code is actually expected to be written. Your
job is to apply them honestly and to be **disciplined about what counts as
CRITICAL** — see *Calibrating severity*, because a gate that cries wolf gets
ignored.

## Workflow

### 1. Determine the diff scope
Review everything that would land in the PR — committed-but-unpushed **and**
uncommitted:

```sh
git fetch origin --quiet 2>/dev/null || true
BASE=$(git merge-base origin/main HEAD 2>/dev/null || echo main)
git diff --name-only "$BASE"...HEAD      # committed since base
git diff --name-only                     # unstaged
git diff --name-only --cached            # staged
```

Union the three lists, drop duplicates. If the working tree is clean and nothing
is ahead of base, say so and stop — there's nothing to review.

### 2. Classify changed files into domains
Bucket each path with the routing table below. Skip files in *Don't review*. Note
the buckets so the report can show coverage.

### 3. Run the lenses (one focused pass per non-empty bucket)
For each non-empty bucket, review **the changed hunks** (use the surrounding file
for context) through that bucket's lenses. For each lens, read its `SKILL.md`
under `.claude/skills/<name>/` and apply its rules to those files. Always add the
general bug/correctness + security pass.

For a diff that touches several domains, **fan out**: spawn one review subagent
per non-empty bucket in parallel (Task tool), each told which skills to load,
which files/hunks to review, and to return findings in the finding format below.
This keeps each lens focused and runs them concurrently. For a tiny diff
(one or two files), just do it inline. Either way, dedupe overlapping findings
(security + a domain lens often flag the same line) before reporting.

### 4. Aggregate, calibrate, verify
Collect all findings, assign severity with the rubric, and **verify every
CRITICAL before trusting it** (see *Calibrating severity*). Demote anything that
doesn't survive verification.

### 5. Report and gate
Emit the report (template below). Verdict is mechanical: **any CRITICAL → BLOCK**;
otherwise PASS (with advisories if there are High/Medium items). End with the
machine-readable verdict line so a future pre-push hook can parse it.

When the verdict is BLOCK, **do not help the user push or open the PR** (don't run
`git push`, `gh pr create`, etc.) until the criticals are resolved — that's the
gate. Offer to fix them instead.

## Routing table — path → lenses

| Path glob | Domain | Lenses (read `.claude/skills/<name>/SKILL.md`) |
|-----------|--------|-----------------------------------------------|
| `client/**/*.{tsx,jsx}` | Frontend UI | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `security` |
| `client/**/*.{ts}` (non-component) | Frontend logic | `frontend-architecture`, `react-best-practices`, `typescript-expert`, `zod` |
| `client/**/*.test.{ts,tsx}` | Frontend tests | `react-testing-library` |
| `server/src/modules/**` | Backend feature | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security` |
| `server/src/db/schema/**`, `**/migrations/**` | Persistence | `postgresql-table-design`, `drizzle-orm-patterns` |
| `server/**` (other) | Backend | `onion-architecture`, `fastify-best-practices`, `typescript-expert`, `security` |
| `reviewer-core/**` | Domain core | `onion-architecture` (pure-core rules), `typescript-expert`, `zod` |
| `e2e/**` | E2E | general bug pass only |
| any `*.{ts,tsx}` | always-on | `security`, general bug/correctness pass |

Notes:
- `security` and the general bug pass run on **every** code bucket — they're the
  cross-cutting lenses and the most common source of true criticals.
- `onion-architecture` is the project's domain-architecture lens; on `server/**`
  and `reviewer-core/**` it checks the dependency rule (no raw SQL in routes, no
  `process.env` in services, no I/O in the pure core, workspace-scoping, etc.).
- A lens that finds nothing relevant is fine — not every file trips every lens.

## Calibrating severity (the heart of the gate)

The gate is only useful if CRITICAL means CRITICAL. Use this rubric, and **before
marking anything CRITICAL, prove it** — cite the exact line and explain the
concrete failure; where it's checkable, verify it (run `pnpm typecheck`, the
relevant test, or trace the data flow). If you can't substantiate the production
impact, it's not critical.

- **CRITICAL — blocks the PR.** Ships a real defect: a security hole (injection,
  auth/authz bypass, secret leak, SSRF, stored XSS), data loss or a destructive
  migration without a guard, **broken tenancy** (a query missing its `workspaceId`
  scope → cross-workspace leak), or code that won't build/run (type error, import
  that doesn't resolve, obvious runtime crash on the happy path). The test: *would
  this cause an incident, a breach, data loss, or a red build if merged?*
- **HIGH — fix before PR, but not a hard block.** A real bug with limited blast
  radius, a missing validation on user input, or an architecture violation that
  bypasses an important invariant (e.g. Drizzle queries in a route, business logic
  in a repository) without yet causing a live incident.
- **MEDIUM — should fix.** Convention drift, missing test coverage for new logic,
  a performance smell, an N+1, a leaky abstraction.
- **LOW — nice to fix.** Naming, formatting, minor readability, a stray TODO.

Severity is about *impact if merged*, not how strongly a lens "dislikes" the code.
An architecture-skill complaint is usually HIGH, not CRITICAL — it becomes
CRITICAL only when the violation produces one of the concrete failures above (a
missing-tenancy query is the classic example: it's both an onion violation **and**
a security/data critical).

## Don't review (skip, but list under "Skipped")
- `server/src/vendor/shared/**`, `client/src/vendor/shared/**` — vendored, kept in
  sync by hand; flag only if the two copies drifted.
- `**/db/migrations/*.sql` — generated; review the schema source, not the SQL.
- Lockfiles, `*.snap`, build output, `node_modules`, generated types.
- Pure formatting-only hunks.

## Report format

Use this structure exactly so the output is scannable and the verdict is
unambiguous:

```
# PR Self-Review — <branch>
**Verdict: ❌ BLOCK (<n> critical)**   ·  diff: <base>...HEAD + working tree
Coverage: <X> files — <f> frontend, <b> backend, <c> core, <o> other (<s> skipped)

## ❌ Critical — must fix before opening the PR (<n>)
- `path:line` — **<title>**
  Why critical: <concrete production/security/build failure>
  Lens: <skill> · Fix: <one-line remedy>

## ⚠️ High (<n>)
- `path:line` — <title> · Lens: <skill> · Fix: <…>

## Medium (<n>)
- `path:line` — <title>

## Low (<n>)
- `path:line` — <title>

## Skipped / not reviewed
- <vendored / generated / lockfiles …>

PR-SELF-REVIEW: BLOCK
```

When clean, the verdict line is `PR-SELF-REVIEW: PASS` and the header shows
`✅ PASS` (or `⚠️ PASS WITH ADVISORIES` if there are High/Medium items but no
criticals). Keep the report tight — link findings to `path:line`, give a
one-line fix, don't paste large code blocks.

## References
- **[references/lens-catalog.md](references/lens-catalog.md)** — per-skill cheat
  sheet: what each lens looks for and its typical CRITICAL signal. Read it when
  you need to brief a per-domain review subagent or want the high-signal checks
  without opening every skill.
