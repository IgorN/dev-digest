/** Pure helpers for the PR-page multi-agent picker. */

import type { AgentRunEstimate } from "@devdigest/shared";

/** Estimates indexed by agent id, for O(1) row lookup. */
export function estimatesByAgent(
  estimates: AgentRunEstimate[] | undefined,
): Map<string, AgentRunEstimate> {
  const m = new Map<string, AgentRunEstimate>();
  for (const e of estimates ?? []) m.set(e.agent_id, e);
  return m;
}

/**
 * The row's duration hint (AC-18). Derived ONLY from that agent's own run
 * history — an agent with no completed run has no estimate and renders the
 * caller's "no estimate" string (`—`), never a fabricated number and never the
 * design's hard-coded `~6s`.
 */
export function durationHint(
  estimate: AgentRunEstimate | undefined,
  noEstimate: string,
): string {
  const ms = estimate?.avg_duration_ms;
  if (ms == null) return noEstimate;
  return `~${(ms / 1000).toFixed(1)}s`;
}

/** Toggle one id in a selection set, preserving the agent-list order elsewhere. */
export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
