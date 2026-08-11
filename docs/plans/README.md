# Implementation Plans

Plans authored by the **`implementation-planner`** agent
(`.claude/agents/implementation-planner.md`) — the **how** that follows a spec's
what/why. One file per feature: `<kebab-feature-name>.md`.

A plan is executed by the `run-plan` skill (`/run-plan plan:docs/plans/<x>.md`),
which dispatches `implementer` agents per the plan's dependency DAG and gates the
result with `architecture-reviewer` + `plan-verifier`.

```
spec-creator → spec (specs/) → implementation-planner → plan (here) → run-plan → code
```

Older plans predating this convention live in `.claude/plans/`.
