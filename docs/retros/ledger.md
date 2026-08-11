# Workflow retro ledger

One row per retro, so multi-agent runs can be compared over time. Written by the
`workflow-retro` skill (`.claude/skills/workflow-retro/`). Costs are deep-mode
figures from the on-disk agent journals and **include nested sub-agents**.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-07-18 | l06-session (ctx-folder + SDD pipeline + onboarding-tour + redesign) | 46 (37 top + 9 nested) | 128K→807K (135.4M cache-read) | 91% | 7.2h session / 3.4h agent-span | 0.47x* | $199.29 | Gate `spec-creator` on design sources — mockups arriving after implementation forced a full redesign round (~$13) |
| 2026-08-03 | l08-session (multi-agent-review + export-to-ci, two full SDD cycles) | 24 (15 top + 9 nested) | 117K→972K (304.9M cache-read, 16.4M cache-write) | 95% | 24.9h session / 4.4h agent-span / 2.5h busy | 0.18x* (1.75x true**) | $237.39 | Cache-write is 43% of run cost ($102). Driver: `spec-creator`/`planner` block on nested sub-agents; stalls >5min expire the cache and re-write the whole prefix (one planner: 2 stalls late in the run = 75% of its write spend). Fan out once, early — or pass findings in the brief. |

\* parallelism = Σ agent spans ÷ session wall-clock. This was an **interactive** session
(long human review/verification gaps), so the figure measures how much of the session was
agent work, not dispatch concurrency — within each wave agents did run in parallel (up to 4).

\*\* true parallelism = Σ agent spans ÷ **union of the intervals when at least one agent was
running** (2.5h), which measures actual dispatch concurrency. The 0.18x column figure is the
ledger convention above (÷ session wall-clock) and is depressed by a 22-hour gap between the
two SDD cycles.
