/* helpers.ts — pure formatting for the workspace-wide Eval Dashboard index.
   No I/O, no React — safe to unit test directly. */
import type { EvalAgentSummary, EvalGlobalRunRow } from "@devdigest/shared";

/** Round-to-percent formatter, e.g. 0.873 -> "87%". */
export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "vN" version tag. */
export function formatVersion(version: number): string {
  return `v${version}`;
}

/** Short date, mirrors the codebase's `toLocaleDateString()` convention
   (VersionsTab.tsx) rather than a heavier date library. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** An agent has at least one run batch when its trend has ≥1 point — the
   empty-state gate (AC-31: zero-batch agents render neutrally, not an error
   or a zeroed chart). */
export function hasRunBatches(agent: EvalAgentSummary): boolean {
  return agent.dashboard.trend.length > 0;
}

/** Sparkline series for an agent's trend — pass_rate is the single
   highest-signal summary metric (recall/precision/citation are already shown
   as their own columns, so the trend line adds a distinct "did it pass"
   view rather than repeating one of them). */
export function trendSeries(agent: EvalAgentSummary): number[] {
  return agent.dashboard.trend.map((t) => t.pass_rate);
}

/** "N/M" pass fraction for an agent's CURRENT state (dashboard.current),
   used in the per-agent "last run" line. */
export function passFraction(agent: EvalAgentSummary): { passed: number; total: number } {
  return {
    passed: agent.dashboard.current.traces_passed,
    total: agent.dashboard.current.traces_total,
  };
}

/** Pass-rate percentage for one global recent-run row (EvalTrendPoint has no
   per-batch case-count field, only the 0..1 pass_rate — the historical
   "recent runs" table can only show a rate, not an "N/M" count; that exact
   count is only available for the agent's CURRENT batch via
   dashboard.current.traces_passed/traces_total). */
export function rowPassPercent(row: EvalGlobalRunRow): string {
  return formatPercent(row.pass_rate);
}
