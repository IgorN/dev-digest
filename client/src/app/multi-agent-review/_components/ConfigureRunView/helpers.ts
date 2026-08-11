/* Pure helpers for the Configure-run form. */
import type { AgentRunEstimate } from "@devdigest/shared";

/** Estimates indexed by agent id, so a card is one map lookup. */
export function byAgentId(estimates: AgentRunEstimate[]): Map<string, AgentRunEstimate> {
  return new Map(estimates.map((e) => [e.agent_id, e]));
}

/**
 * AC-30 — the pre-run aggregate over the SELECTED agents: duration is the
 * MAXIMUM (they fan out in parallel), cost is the SUM (every lane is paid for).
 * Agents lacking an estimate for a metric are excluded from that metric, and
 * when no selected agent has one at all the metric is `null` so the UI renders
 * `—` rather than `0` (AC-31).
 */
export function aggregateEstimate(
  estimates: Map<string, AgentRunEstimate>,
  selectedIds: string[],
): { durationMs: number | null; costUsd: number | null } {
  const durations: number[] = [];
  const costs: number[] = [];
  for (const id of selectedIds) {
    const e = estimates.get(id);
    if (!e) continue;
    if (e.avg_duration_ms != null) durations.push(e.avg_duration_ms);
    if (e.avg_cost_usd != null) costs.push(e.avg_cost_usd);
  }
  return {
    durationMs: durations.length ? Math.max(...durations) : null,
    costUsd: costs.length ? costs.reduce((a, c) => a + c, 0) : null,
  };
}
