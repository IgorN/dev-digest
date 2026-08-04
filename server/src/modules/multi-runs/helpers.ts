import type {
  AgentRunEstimate,
  FindingRecord,
  LatestMultiRunRef,
  MultiRunAgent,
  MultiRunTotals,
} from '@devdigest/shared';
import { findingRowToDto } from '../reviews/helpers.js';
import { SUCCESSFUL_RUN_STATUS } from './constants.js';
import type { AgentEstimateRow, MultiRunLaneRow, MultiRunRow } from './repository.js';
import type { GroupingAgent } from './types.js';

/**
 * Pure DTO mapping for the multi-run module — row shapes in, contract shapes
 * out. No I/O, no `container`, no Drizzle: everything here operates purely on
 * its arguments.
 */

/**
 * The key a lane is addressed by inside a verdict cell.
 *
 * `agent_runs.agent_id` is `on delete set null`, but `MultiRunVerdictCell`'s
 * `agent_id` is a required string and cells must stay positionally aligned with
 * the `agents` array — so a deleted agent's lane falls back to its RUN id,
 * which is stable and unique within the multi-run.
 */
export function laneCellKey(lane: MultiRunLaneRow): string {
  return lane.run.agentId ?? lane.run.id;
}

/**
 * Display name for a lane. Falls back to the run's stored provider/model
 * identity when the agent row is gone — the spec's accepted behaviour for
 * "an agent is deleted after a multi-run completes" (no historical name
 * snapshot is introduced).
 */
export function laneAgentName(lane: MultiRunLaneRow): string {
  if (lane.agentName) return lane.agentName;
  const { provider, model } = lane.run;
  if (provider || model) return [provider, model].filter(Boolean).join('/');
  return 'Deleted agent';
}

/** One lane as the result document's per-agent entry. */
export function laneToAgent(lane: MultiRunLaneRow): MultiRunAgent {
  return {
    agent_id: lane.run.agentId,
    agent_name: laneAgentName(lane),
    run_id: lane.run.id,
    // Non-terminal runs are reported as-is: an in-progress multi-run returns a
    // COMPLETE document with live run states, never a partial or fabricated one.
    status: lane.run.status ?? 'running',
    duration_ms: lane.run.durationMs,
    cost_usd: lane.run.costUsd,
    score: lane.run.score,
    summary: lane.review?.summary ?? null,
    findings: lane.findings.map((row): FindingRecord => findingRowToDto(row)),
  };
}

/** One lane as the pure grouping computation's input. */
export function laneToGroupingAgent(lane: MultiRunLaneRow): GroupingAgent {
  return {
    cellKey: laneCellKey(lane),
    status: lane.run.status,
    findings: lane.findings.map((row) => ({
      id: row.id,
      file: row.file,
      start_line: row.startLine,
      end_line: row.endLine,
      severity: row.severity,
      title: row.title,
      rationale: row.rationale,
      confidence: row.confidence,
    })),
  };
}

/**
 * Run totals. Wall clock is the MAXIMUM duration across COMPLETED runs (the
 * lanes fan out, so the fan-out takes about as long as its slowest lane, not
 * the sum); spend is the SUM of every priced lane. Both are null rather than 0
 * when nothing qualifies, so the UI can render "—" instead of a fake zero.
 */
export function computeTotals(lanes: MultiRunLaneRow[]): MultiRunTotals {
  const durations = lanes
    .filter((l) => l.run.status === SUCCESSFUL_RUN_STATUS)
    .map((l) => l.run.durationMs)
    .filter((v): v is number => v != null);
  const costs = lanes.map((l) => l.run.costUsd).filter((v): v is number => v != null);
  return {
    max_duration_ms: durations.length ? Math.max(...durations) : null,
    total_cost_usd: costs.length ? costs.reduce((sum, c) => sum + c, 0) : null,
    agent_count: lanes.length,
  };
}

/**
 * One aggregate row as a pre-run estimate. Averages stay NULL when the agent
 * has no run carrying that metric — the UI renders "—" for an absent metric and
 * must never see a fabricated `0s` / `$0.00`. The two sample counts are
 * reported separately because the two averages can have different denominators
 * (e.g. an unpriced provider yields durations but no costs).
 */
export function estimateRowToDto(row: AgentEstimateRow): AgentRunEstimate {
  return {
    agent_id: row.agentId,
    agent_name: row.agentName,
    avg_duration_ms: row.avgDurationMs,
    avg_cost_usd: row.avgCostUsd,
    duration_sample_count: row.durationSampleCount,
    cost_sample_count: row.costSampleCount,
    last_summary: row.lastSummary,
  };
}

/** A resolved multi-run as the pointer the client navigates with. */
export function latestRefFromRow(row: MultiRunRow): LatestMultiRunRef {
  return {
    id: row.id,
    pr_id: row.prId,
    pr_number: row.prNumber,
    pr_title: row.prTitle,
    ran_at: row.ranAt.toISOString(),
  };
}
