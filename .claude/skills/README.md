# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion/Clean layering for `server/src/modules/` (routes→service→repository), the dependency rule, `container` DI |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [frontend-architecture](frontend-architecture/SKILL.md) | Frontend | UI architecture & code organization: folder structure, colocation, component splitting, where code lives (React + Next.js) |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Shared | Capture durable, file-grounded insights into each module's `INSIGHTS.md` (append-only) |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow | Local pre-PR gate: routes changed files through the project's domain skills as review lenses + bug/OWASP pass, blocks on CRITICAL |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill lives in its own folder and has:

- `SKILL.md` — main file: YAML frontmatter (`name`, `description`, optional
  `version`) + the rules/workflow (required). The `description` is the trigger — say
  what it does AND when to use it. Keep it under ~500 lines; push depth into references.
- `references/` — detail docs (or a flat `examples.md` / `references.md`) loaded
  on demand. Larger skills split by topic, e.g. `references/folder-structure.md`.
- `README.md` — optional, for skills that benefit from a stated focus, scope,
  related-skills comparison, version history, and a sources list (see
  `frontend-architecture/README.md`).

Keep this catalog in sync when adding or removing a skill.
