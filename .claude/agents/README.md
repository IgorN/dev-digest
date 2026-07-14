# `.claude/agents/` — DevDigest sub-agent pipeline

A pipeline of Claude Code sub-agents used to develop DevDigest itself (not
to be confused with `docs/agent-prompts/`, which holds prompts for
DevDigest-the-product's own built-in PR-review agents).

Goal: `researcher`/`brainstorm` → `planner` → `implementer` →
(`architecture-reviewer` ∥ `security-reviewer` ∥ `test-writer`) →
`plan-verifier` → `doc-writer`, with read-only agents doing the thinking and
write-capable agents doing the touching, so a plan gets validated before any
file changes — and gets checked for completeness after.

Two more agents sit outside this per-feature pipeline: `investigator` (a
narrower, cheaper codebase-lookup agent — agents can't call each other, so
the orchestrator dispatches it) and `insight-curator` (a periodic
maintenance pass over accumulated `INSIGHTS.md` entries).

| Agent                   | Access              | Model     | Role                                              |
|-------------------------|---------------------|-----------|---------------------------------------------------|
| `researcher`            | read-only + web     | `sonnet`  | grounding research: this repo and/or the web      |
| `investigator`          | read-only           | `haiku`   | quick codebase lookups & dependency traces        |
| `brainstorm`            | read-only           | `inherit` | weigh options on genuine tradeoffs, pre-plan      |
| `planner`               | read-only           | `inherit` | Development Plan + per-agent specs                |
| `implementer`           | write               | `inherit` | code from a plan spec, one surface per instance   |
| `test-writer`           | write (tests only)  | `inherit` | tests for new/changed behavior                    |
| `architecture-reviewer` | read-only           | `inherit` | layering/boundary review against project skills   |
| `security-reviewer`     | read-only           | `opus`    | OWASP diff review against the `security` skill    |
| `plan-verifier`         | read-only           | `inherit` | plan-completeness check with a fresh context      |
| `doc-writer`            | write (`docs/` only)| `inherit` | docs + Mermaid diagrams from finished work        |
| `insight-curator`       | read-only           | `inherit` | INSIGHTS.md dedup / staleness / promotion report  |

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
`planner` for questions with one clear answer. Reasons through a decision
from a few distinct angles internally (since it can't spawn parallel
sub-agents itself) rather than only producing a single take.

- Tools: `Read, Grep, Glob`.
- Model: `inherit`.

### `planner` — read-only
Turns a feature request (plus whatever a `researcher` pass already found)
into a structured **Development Plan**: affected surfaces, relevant existing
`INSIGHTS.md` entries, a task breakdown, and a spec per downstream agent
(scope, required skills, acceptance criteria). Knows the full project skill
registry so it can assign the right skills to each `implementer` spec, and
knows the pipeline's blind spots: e2e work and vendored-contract changes
(`*/src/vendor/shared/`) get flagged as orchestrator/human tasks, not
assigned to a parallel `implementer`. Cannot write the plan to disk itself —
the calling process persists it to `.claude/plans/<feature-slug>.md`.

- Tools: `Read, Grep, Glob` — read-only.
- Model: `inherit` (planning quality benefits from a strong model).

### `implementer` — write (one instance per surface)
Implements a single agent-spec from a Development Plan. Re-reads the
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

- Tools: `Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite`.
- Model: `inherit`.

### `test-writer` — write (test files only)
Writes tests for whatever surface it's pointed at — reads the package's
`INSIGHTS.md` first (testing gotchas live there), analyzes the code under
test (interfaces, edge cases, error paths), then writes tests matching the
existing framework conventions in that package, including the server naming
rule that Docker-dependent tests MUST end in `*.it.test.ts`. Loads
`react-testing-library` for frontend work via the `Skill` tool; backend work
matches the surrounding `*.test.ts` files directly. Runs only the smallest
relevant suite to confirm its own tests execute; the `e2e/` suite is out of
scope. Never touches implementation files or edits an existing test without
being asked, and reports **insight candidates** back like `implementer`.

- Tools: `Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite`.
- Model: `inherit`.

### `architecture-reviewer` — read-only
Checks a diff against this project's own layering rules rather than general
architecture opinion — loads `onion-architecture` (backend) and
`frontend-architecture` (UI) as its binding ruleset via the `Skill` tool
before reviewing anything. Flags boundary violations, abstraction leaks, and
excess coupling; defaults every finding to a non-blocking "needs-discussion"
severity, reserving "blocking" for unambiguous rule breaks.

- Tools: `Read, Grep, Glob, Skill`.
- Model: `inherit`.

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
- Model: `opus` — the one deliberate deviation from `inherit` in this set;
  security review is where the strongest model earns its cost.

### `plan-verifier` — read-only
Given a Development Plan and the resulting code, checks whether every task
and acceptance criterion was actually built — a completeness check, not a
quality review. Deliberately run with a fresh, unbiased view (plan + code
only, not the discussion that produced them) so it doesn't inherit the
implementer's blind spots. Has no `Bash`, so it verifies that tests *exist*
and look like they cover a criterion, but is explicit in its own verdict
that it hasn't re-run them live.

- Tools: `Read, Grep, Glob`.
- Model: `inherit`.

### `doc-writer` — write (docs/ paths only)
Converts a finished implementation, a Development Plan, or arbitrary
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
