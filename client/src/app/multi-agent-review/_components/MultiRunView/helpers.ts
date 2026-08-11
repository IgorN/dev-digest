/* Pure helpers for the multi-run result view. */
import type { MultiRunAgent } from "@devdigest/shared";

/** Score-band colour, matching the design's tab badge / score-ring banding. */
export function scoreBandColor(score: number): string {
  if (score >= 70) return "var(--ok)";
  if (score >= 50) return "var(--warn)";
  return "var(--crit)";
}

/** Agent id → display name, for the disagreement block's per-cell headers. */
export function agentNamesById(agents: MultiRunAgent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of agents) if (a.agent_id) map.set(a.agent_id, a.agent_name);
  return map;
}

/**
 * The `result.status.*` i18n key for a run status, or null for `done` — a
 * completed lane renders the design's plain `<duration> · <cost>` header with
 * no status word, while every other state is called out explicitly (AC-37).
 */
export function statusKey(status: string): string | null {
  if (status === "done") return null;
  if (status === "failed" || status === "cancelled" || status === "running") return status;
  return "running";
}

/** Failed/cancelled read as an error colour; anything in flight is neutral. */
export function statusColor(status: string): string {
  return status === "failed" || status === "cancelled" ? "var(--crit)" : "var(--text-muted)";
}
