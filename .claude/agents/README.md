# `.claude/agents/` — DevDigest sub-agent pipeline

A pipeline of Claude Code sub-agents used to develop DevDigest itself (not
to be confused with `docs/agent-prompts/`, which holds prompts for
DevDigest-the-product's own built-in PR-review agents).

The pipeline follows **Spec-Driven Development (SDD)**:

```
spec-creator → spec (WHAT/WHY, specs/) → implementation-planner → plan (HOW, docs/plans/)
    → /run-plan: implementer(s) per DAG → (architecture-reviewer ∥ plan-verifier) → bounded fix loop
```

`spec-creator` and `implementation-planner` are run **manually, one at a
time** — a human reviews the spec, then the plan, before anything executes.
The `run-plan` skill (`.claude/skills/run-plan/`) then drives the approved
plan to reviewed code; it deliberately does **not** invoke `test-writer`
(disabled by default for token cost — coverage comes from each
implementer's self-verification) and never pushes (run `pr-self-review`
before push). `researcher`/`brainstorm` sit upstream as optional grounding;
`security-reviewer` joins the run-plan gate conditionally (only when the
diff touches auth/input/secrets/endpoints) and `doc-writer` runs when a
finished feature needs documenting.

Two more agents sit outside this per-feature pipeline: `investigator` (a
narrower, cheaper codebase-lookup agent) and `insight-curator` (a periodic
maintenance pass over accumulated `INSIGHTS.md` entries).

**Sub-agent fan-out is a cost decision, not just a context one.** `spec-creator`
and `implementation-planner` hold the `Agent` tool and block while their
children run. A stall over ~5 minutes expires the prompt cache and re-writes the
parent's whole accumulated prefix at cache-write rates — and the prefix only
grows, so a late fan-out costs far more than an early one. Both are instructed
to delegate once, in a single parallel batch, near the start of their run. When
the orchestrator already has investigation results, passing them in the brief
beats having the agent re-derive them: it removes the stall and the duplicate
reads at the same time. See `docs/retros/ledger.md` for the measured numbers.

| Agent                    | Access                 | Model     | Role                                               |
|--------------------------|------------------------|-----------|----------------------------------------------------|
| `researcher`             | read-only + web        | `sonnet`  | grounding research: this repo and/or the web       |
| `investigator`           | read-only              | `haiku`   | quick codebase lookups & dependency traces         |
| `brainstorm`             | read-only              | `inherit` | weigh options on genuine tradeoffs, pre-spec       |
| `spec-creator`           | write (`specs/` only)  | `opus`    | SDD spec: EARS criteria, edge cases, contracts     |
| `implementation-planner` | write (`docs/plans/`)  | `opus`    | Implementation Plan: phased task DAG, owned paths  |
| `implementer`            | write                  | `inherit` | code from a plan task, one surface per instance    |
| `test-writer`            | write (tests only)     | `inherit` | **disabled by default** (token cost) — on request  |
| `architecture-reviewer`  | read-only              | `sonnet`  | layering/boundary review against project skills    |
| `security-reviewer`      | read-only              | `opus`    | OWASP diff review against the `security` skill     |
| `plan-verifier`          | read-only              | `sonnet`  | plan-completeness check with a fresh context       |
| `doc-writer`             | write (`docs/` only)   | `inherit` | docs + Mermaid diagrams from finished work         |
| `insight-curator`        | read-only              | `inherit` | INSIGHTS.md dedup / staleness / promotion report   |

## Agents

### `researcher` — read-only
Investigates the current codebase or the web on request and returns a
structured report: `Findings` (each traceable to a `file:line` or a fetched
URL), `Summary`, an explicit `Not found` list, and `Open questions` when the
request was ambiguous (returned as its final response — a sub-agent can't
interview mid-run). Runs one bounded pass — never the `deep-research`
skill, never a fan-out into further sub-agents.

- Tools: `Read, Grep, Glob, WebSearch, WebFetch` — no write tools, no `Bash`.
- Model: `sonnet` (pinned, regardless of the caller's model).

### `investigator` — read-only
Narrower, cheaper counterpart to `researcher` for codebase-only lookups —
no web access. Checks the package's curated `docs/`/`INSIGHTS.md` first,
then searches for where something is defined/used and traces
dependencies/call sites (callers, import chains) in either direction,
truncating and saying so if a trace fans out very wide instead of
exhaustively listing every hit.

- Tools: `Read, Grep, Glob`.
- Model: `haiku` — quick, high-volume lookups where `researcher`'s broader
  (and web-capable) pass would be overkill.

### `brainstorm` — read-only
Generates and weighs solution options before any plan exists — but only
when there's a genuine tradeoff; explicitly recommends skipping straight to
`spec-creator` for questions with one clear answer. Reasons through a decision
from a few distinct angles internally (since it can't spawn parallel
sub-agents itself) rather than only producing a single take.

- Tools: `Read, Grep, Glob`.
- Model: `inherit`.

### `spec-creator` — write (spec files under `specs/` only)
Front of the SDD chain. Turns a request plus design sources (pasted text,
Figma/URLs via `WebFetch`, screenshots, repo code) into a single spec file:
problem & why, goals/non-goals, user stories, **EARS acceptance criteria**
with `AC-N` ids, edge cases, non-functional thresholds, cross-module
interactions, contract *shapes*, and untrusted-input handling. Actively
analyses the design for gaps, uncovered corner cases, and UX improvements;
returns blocking questions as its final response (subagents can't interview
mid-run) and records the rest as `[NEEDS CLARIFICATION]`. Reads
`INSIGHTS.md` only for the packages the
feature touches; fans out parallel `researcher` sub-agents for broad
strands. Spec location by scope: `<package>/specs/` for single-package
features, top-level `specs/` for cross-module ones (see `specs/README.md`).
Runs a traceability self-check before returning. Writes **only** spec
files — everything else is read-only to it. What/why only — never the how.

- Tools: `Read, Glob, Grep, Bash, WebFetch, Write, Edit, Agent`.
- Model: `opus` — spec quality pays for itself downstream.

### `implementation-planner` — write (`docs/plans/` only)
Takes an **agreed set of requirements** (usually a `spec-creator` spec) and
produces the **Implementation Plan** at `docs/plans/<feature-slug>.md`. It
does not author or edit specs — requirements are input. Always starts by
verifying them (restate as R-ids, ask 1–4 clarifying questions, give
explicit recommendations), then needs the user's choice of
**multi-agent (parallel)** vs **single-agent** execution — open questions
and the mode question come back as its final response, and it plans on
re-invocation with the answers — shaping the plan accordingly: phased tasks with a dependency DAG, per-task skills,
non-overlapping `Owned paths` (multi-agent), measurable acceptance traced
to R/AC ids. Knows the pipeline's blind spots: e2e work and
vendored-contract changes (`*/src/vendor/shared/`) get owner
`orchestrator/human`, not a parallel `implementer`. **Never runs tests or
builds itself** (the former token sink) — acceptance names the commands the
implementers will run. Diffs the two vendored `shared` copies before planning
any contract change, so pre-existing hand-sync drift surfaces as a planned
task instead of stalling a parallel run.

- Tools: `Read, Glob, Grep, Bash, Agent, Write`.
- Model: `opus` (planning quality benefits from a strong model).

### `implementer` — write (one instance per surface)
Implements a single task from an Implementation Plan. Re-reads the
`INSIGHTS.md` of every module in its scope directly (the plan may be stale)
and loads the skills the task actually needs via the `Skill` tool (the
spec's explicit skill list wins over surface defaults). Stays inside its
assigned files/dirs — that's what lets a backend instance and a frontend
instance run in parallel without colliding; vendored contracts
(`server|client/src/vendor/shared/`) are never edited directly, only
reported for the orchestrator to sync both copies. Self-review is
deliberately narrow: does the code match the spec, and do the relevant
tests pass — no architecture/security review, no new test suites. Reports
**insight candidates** back so discoveries survive the discarded context.
Destructive git is forbidden outright (`stash`, `reset`, `checkout --`,
`restore`, `clean`, commits, branch switching): instances share one checkout
with each other and with the orchestrator's uncommitted work, so any of those
silently destroys work the agent can't see.

- Tools: `Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite`.
- Model: `inherit`.

### `test-writer` — write (test files only) — **disabled by default**
Kept in the registry but **not invoked by the `run-plan` workflow** (token
cost); coverage there comes from each implementer's self-verification.
Dispatch it explicitly when a change genuinely needs a dedicated test pass.
Writes tests for whatever surface it's pointed at — reads the package's
`INSIGHTS.md` first (testing gotchas live there), analyzes the code under
test (interfaces, edge cases, error paths), then writes tests matching the
existing framework conventions in that package, including the server naming
rule that Docker-dependent tests MUST end in `*.it.test.ts`. Covers the
client surface as a first-class citizen: vitest + jsdom + RTL, colocated
`*.test.tsx`, with a hard rule — query by role/text (no `data-testid`),
`userEvent` for interaction, mock only I/O seams (network/TanStack Query,
`EventSource` SSE, browser APIs), always hermetic. Loads
`react-testing-library` for frontend work via the `Skill` tool; backend work
matches the surrounding `*.test.ts` files directly. Runs only the smallest
relevant suite plus the touched package's typecheck to confirm its own
tests execute; the `e2e/` suite is out of scope. Never touches implementation files or edits an existing test without
being asked, and reports **insight candidates** back like `implementer`.

- Tools: `Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite`.
- Model: `inherit`.

### `architecture-reviewer` — read-only
Checks a diff against this project's own layering rules rather than general
architecture opinion. Works lazily: first establishes the **changed-file
set** (the caller must pass it — the agent has no `Bash` and cannot compute
a diff; given no set, it flags that it audited a guess and asks for the real
list), then loads via `Skill` **only the rulesets that set can violate** —
`onion-architecture` when `server/`/`reviewer-core/` files are present,
`frontend-architecture` when `client/` files are. Flags boundary violations,
abstraction leaks, and excess coupling; defaults every finding to a
non-blocking "needs-discussion" severity, reserving "blocking" for
unambiguous rule breaks.

- Tools: `Read, Grep, Glob, Skill`.
- Model: `sonnet` — a read-only, rule-driven gate that runs on every
  `run-plan` pass (and inside its fix loop); Opus wasn't earning its cost here.

### `security-reviewer` — read-only
Scans only the changed files in a diff for OWASP Top 10:2025 vulnerabilities,
grounded in this project's own `security` skill via the `Skill` tool
(translating the skill's Express/Mongo-flavored examples to this Fastify +
Drizzle/Postgres stack). Every finding gets a severity
(Critical/High/Medium/Low), a CWE/OWASP tag, a concrete exploit scenario,
and a suggested fix; false positives are filtered rather than padded in.
Explicitly checks this project's own secrets convention
(`container.secrets`, never `process.env`).

- Tools: `Read, Grep, Glob, Skill`.
- Model: `opus` — security review is where the strongest model earns its
  cost; it runs rarely (targeted diffs), unlike the per-run `sonnet` gates.

### `plan-verifier` — read-only
Given an Implementation Plan and the resulting code, checks whether every task
and acceptance criterion was actually built — a completeness check, not a
quality review. Deliberately run with a fresh, unbiased view (plan + code
only, not the discussion that produced them) so it doesn't inherit the
implementer's blind spots. Has no `Bash`, so it verifies that tests *exist*
and look like they cover a criterion, but is explicit in its own verdict
that it hasn't re-run them live. Traces by the plan's `T-id`s and, when the
plan cites a spec, by the spec's `AC-N` ids.

- Tools: `Read, Grep, Glob`.
- Model: `sonnet` — same reasoning as `architecture-reviewer`: a structured,
  read-only completeness gate.

### `doc-writer` — write (docs/ paths only)
Converts a finished implementation, an Implementation Plan, or arbitrary
supplied content into documentation — always reading the real code first
rather than trusting what a plan intended. Knows this repo's placement
convention: per-package docs colocated in that package's own `docs/`,
cross-cutting docs in root `docs/` (never `docs/agent-prompts/` — that
belongs to DevDigest-the-product's own reviewer prompts), and never
`CLAUDE.md`/`INSIGHTS.md`. Uses the `mermaid-diagram` skill for any diagrams.

- Tools: `Read, Write, Edit, Grep, Glob, Skill`.
- Model: `inherit`.

### `insight-curator` — read-only, maintenance
Not part of the per-feature pipeline — run on a periodic cadence instead.
Sweeps every module's `INSIGHTS.md` and reports: duplicate/overlapping
entries, stale or contradicted ones (evidence paths that no longer exist,
resolved open questions, entries superseded by newer ones), and which
insights are mature enough (recurring, broadly applicable, still durable)
to promote into a skill, a package's `docs/`, or `e2e/specs/`. Never edits
`INSIGHTS.md` or anything else — always a proposal for a human or the
orchestrator to act on.

- Tools: `Read, Grep, Glob`.
- Model: `inherit`.
