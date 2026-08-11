# Workflow retro ledger

One row per retro, so multi-agent runs can be compared over time. Written by the
`workflow-retro` skill (`.claude/skills/workflow-retro/`). Costs are deep-mode
figures from the on-disk agent journals and **include nested sub-agents**.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-07-18 | l06-session (ctx-folder + SDD pipeline + onboarding-tour + redesign) | 46 (37 top + 9 nested) | 128K→807K (135.4M cache-read) | 91% | 7.2h session / 3.4h agent-span | 0.47x* | $199.29 | Gate `spec-creator` on design sources — mockups arriving after implementation forced a full redesign round (~$13) |

\* parallelism = Σ agent spans ÷ session wall-clock. This was an **interactive** session
(long human review/verification gaps), so the figure measures how much of the session was
agent work, not dispatch concurrency — within each wave agents did run in parallel (up to 4).
