import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalCase, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** A case plus its most recent persisted run (if any) — what `GET
   /agents/:id/eval-cases` returns, so a case list survives a page reload
   without collapsing every row back to "never run" (that neutral state
   should mean "genuinely never run", not "the client forgot"). `null` when
   the case has no runs yet. */
export const EvalCaseWithLatestRun = EvalCase.extend({
  latest_run: EvalRunRecord.nullable(),
});
export type EvalCaseWithLatestRun = z.infer<typeof EvalCaseWithLatestRun>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * One point on the dashboard trend — one row per RUN BATCH (all case-rows
 * inserted by a single `POST /agents/:id/eval-runs` call), not per case-row.
 * `run_id` is the batch id (`eval_runs.run_batch_id`); `agent_version` pins the
 * agent config snapshot (`eval_runs.agent_version`) the batch was executed
 * against, so two batches can be compared even after the agent's live config
 * has since moved on.
 */
export const EvalTrendPoint = z.object({
  run_id: z.string(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  /** One row per run BATCH (see `EvalTrendPoint`), newest first. */
  recent_runs: z.array(EvalTrendPoint),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

/** Request body for `POST /agents/:id/eval-runs`. Omitted/empty = every case in the set. */
export const EvalRunBatchInput = z.object({
  case_ids: z.array(z.string()).optional(),
});
export type EvalRunBatchInput = z.infer<typeof EvalRunBatchInput>;

/** Response of `POST /agents/:id/eval-runs` — the per-case results plus the refreshed dashboard. */
export const EvalRunBatchResponse = z.object({
  run_batch_id: z.string(),
  results: z.array(EvalRunResult),
  dashboard: EvalDashboard,
});
export type EvalRunBatchResponse = z.infer<typeof EvalRunBatchResponse>;

/** Request body for the one-click "turn this finding into an eval case" action. */
export const EvalCaseFromFindingInput = z.object({
  finding_id: z.string(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/** One agent's row on the workspace-wide Eval Dashboard index. */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  agent_model: z.string(),
  dashboard: EvalDashboard,
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** One row in the workspace-wide "recent eval runs · all agents" table. */
export const EvalGlobalRunRow = EvalTrendPoint.extend({
  agent_id: z.string(),
  agent_name: z.string(),
});
export type EvalGlobalRunRow = z.infer<typeof EvalGlobalRunRow>;

/** Response of `GET /eval-dashboard` — the workspace-wide index view. */
export const EvalWorkspaceDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalGlobalRunRow),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
  /**
   * Set for entries whose real payload is binary/huge (the runner bundle): the
   * client renders this marker instead, and `contents` is the empty string —
   * shipping 1.6 MB of ncc output through the preview response would be absurd.
   */
  placeholder: z.string().nullish(),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
  /**
   * The user's hand-edited workflow contents from the wizard's Preview step.
   * Absent means "generate it" — the server never silently keeps a stale copy.
   */
  workflow: z.string().optional(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

// Declared before `CiInstallation`, which derives a status from its runs — a
// `const` referenced before its initializer would throw at module load.
//
// `blocked` is NOT a failure: the review ran, found something at or above the
// exported `ci_fail_on` severity, and deliberately exited non-zero to stop the
// merge. It is kept distinct from `failed` (the runner or the artifact broke)
// because collapsing the two would report the feature working as the feature
// breaking — and distinct from `succeeded` because the GitHub check IS red.
export const CiRunStatus = z.enum([
  'succeeded',
  'blocked',
  'failed',
  'no_findings',
  'running',
]);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  workspace_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  /** How the runner posts its result; travels to CI as a workflow env var. */
  post_as: z.enum(['github_review', 'pr_comment', 'none']),
  triggers: z.array(z.string()),
  base: z.string(),
  /**
   * Pinned at first install and never re-derived from the agent's name: the
   * runner hard-fails on more than one manifest and the commit path cannot
   * delete, so a rename would otherwise brick the installation.
   */
  manifest_path: z.string(),
  workflow_path: z.string(),
  /** Monotonic export counter, incremented on every re-export. */
  workflow_version: z.number().int(),
  pr_url: z.string().nullable(),
  last_ingest_at: z.string().nullable(),
  /** The gate policy as it was written into the committed manifest. */
  exported_ci_fail_on: CiFailOn.nullable(),
  /** Derived, not stored: null ⇒ no run has arrived yet. */
  status: CiRunStatus.nullable(),
  last_activity_at: z.string().nullable(),
  /** True when the agent's current `ci_fail_on` differs from the exported one. */
  policy_drift: z.boolean(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
  repo: z.string(),
  file_count: z.number().int(),
});
export type CiExport = z.infer<typeof CiExport>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  workspace_id: z.string(),
  /** The `agent_runs` row this ingest created (`source='ci'`), when one exists. */
  agent_run_id: z.string().nullable(),
  /** GitHub Actions run id — the idempotency key for re-ingesting the same run. */
  github_run_id: z.string(),
  repo: z.string(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullish(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/** `GET /ci-runs` — the rows plus everything the filter chips need, in one trip. */
export const CiRunsResponse = z.object({
  runs: z.array(CiRun),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  repos: z.array(z.string()),
});
export type CiRunsResponse = z.infer<typeof CiRunsResponse>;

/**
 * Outcome of a Refresh. Partial success is normal — one unreadable artifact
 * must not mask the runs that ingested fine, so failures are itemised rather
 * than collapsed into an error.
 */
export const CiIngestResult = z.object({
  examined: z.number().int(),
  ingested: z.number().int(),
  skipped: z.number().int(),
  already_known: z.number().int(),
  failures: z.array(z.object({ github_run_id: z.string(), reason: z.string() })),
});
export type CiIngestResult = z.infer<typeof CiIngestResult>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
