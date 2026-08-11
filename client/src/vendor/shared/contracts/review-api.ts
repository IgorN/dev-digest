import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
  /** Set when the launch grouped its runs under a multi-run; null for legacy single/all runs. */
  multi_run_id: z.string().nullish(),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

// ===========================================================================
// Multi-Agent Review
// ===========================================================================

/**
 * Per-agent pre-run estimate for the picker and the Configure-run page.
 * Averages come from that agent's COMPLETED runs; an agent with no history has
 * null averages and a zero sample count, which the UI renders as "—" rather
 * than inventing a number. `last_summary` backs the one-line blurb on the
 * agent card (its most recent review summary).
 */
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  duration_sample_count: z.number().int(),
  cost_sample_count: z.number().int(),
  last_summary: z.string().nullish(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;

/**
 * One agent's stance at a grouped code location.
 * `flagged` — that agent produced a finding overlapping the group's range.
 * `did_not_flag` — that agent's run completed and produced no such finding.
 * `no_result` — the run failed, was cancelled, or is still in flight; it is
 * NOT evidence of agreement and is excluded from the conflict computation.
 */
export const MultiRunVerdictCell = z.object({
  agent_id: z.string(),
  verdict: z.enum(['flagged', 'did_not_flag', 'no_result']),
  severity: z.string().nullish(),
  rationale: z.string().nullish(),
  finding_id: z.string().nullish(),
});
export type MultiRunVerdictCell = z.infer<typeof MultiRunVerdictCell>;

/** A group of findings at one code location, with every agent's stance. */
export const MultiRunGroup = z.object({
  file: z.string(),
  line: z.number().int(),
  label: z.string(),
  /** ≥2 distinct verdict values among agents that produced a result. */
  conflict: z.boolean(),
  cells: z.array(MultiRunVerdictCell),
});
export type MultiRunGroup = z.infer<typeof MultiRunGroup>;

/** One agent's lane inside a multi-run: its run, its stats, its findings. */
export const MultiRunAgent = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  run_id: z.string(),
  status: z.string(),
  duration_ms: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
  score: z.number().int().nullish(),
  summary: z.string().nullish(),
  findings: z.array(FindingRecord),
});
export type MultiRunAgent = z.infer<typeof MultiRunAgent>;

/** Wall-clock is the MAX across lanes (they fan out); spend is the SUM. */
export const MultiRunTotals = z.object({
  max_duration_ms: z.number().int().nullish(),
  total_cost_usd: z.number().nullish(),
  agent_count: z.number().int(),
});
export type MultiRunTotals = z.infer<typeof MultiRunTotals>;

/** The whole multi-run as one document — what the result page renders. */
export const MultiRunDocument = z.object({
  id: z.string(),
  ran_at: z.string(),
  pr: z.object({ id: z.string(), number: z.number().int(), title: z.string() }),
  agents: z.array(MultiRunAgent),
  groups: z.array(MultiRunGroup),
  totals: MultiRunTotals,
});
export type MultiRunDocument = z.infer<typeof MultiRunDocument>;

/** Pointer to a multi-run, enough for the client to navigate to it. */
export const LatestMultiRunRef = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  pr_title: z.string(),
  ran_at: z.string(),
});
export type LatestMultiRunRef = z.infer<typeof LatestMultiRunRef>;

/**
 * Answer to "what is the most recent multi-run for this scope".
 * The wrapper object is deliberate: "no multi-run yet" is a typed 2xx with
 * `multi_run: null`, NOT a 404 — 404 stays reserved for an unresolvable or
 * cross-workspace explicit multi-run id.
 */
export const LatestMultiRunResponse = z.object({
  multi_run: LatestMultiRunRef.nullable(),
});
export type LatestMultiRunResponse = z.infer<typeof LatestMultiRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({ pr_id: z.string() });
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
