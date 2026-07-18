import type { DevDigestApi } from '../ports/devdigest-api.js';
import { UpstreamHttpError } from '../ports/devdigest-api.js';
import { McpToolError } from '../domain/errors.js';
import { narrowFinding, type NarrowFinding } from '../domain/shape.js';
import type { RunPrCache } from './run-pr-cache.js';

export interface RunAgentOnPrInput {
  repo: string;
  pr_number: number;
  agent: string;
  wait_seconds?: number;
  idempotency_key?: string;
}

export type RunAgentOnPrOutput =
  | {
      run_id: string;
      status: 'done';
      verdict: string | null;
      findings: NarrowFinding[];
      next_action: null;
    }
  | {
      run_id: string;
      status: 'running';
      verdict: null;
      findings: [];
      next_action: string;
    }
  | {
      run_id: string;
      status: 'failed' | 'cancelled';
      error: string;
      next_action: string;
    };

const POLL_INTERVAL_MS = 1000;

/**
 * Application ring. Honors image rule #1 ("outcome, not operation") without
 * literally blocking on the multi-minute LLM review the backend already runs
 * fire-and-forget (server/src/modules/reviews/service.ts:103-138): resolve
 * repo/PR/agent by human-readable name, trigger the review, then wait up to
 * `wait_seconds` (capped) for it to finish. If it finishes in time, findings
 * come back inline (a complete outcome); otherwise a `run_id` + "running"
 * status + an explicit next step is returned (approved-plan A3).
 *
 * `idempotency_key` is accepted in the input schema for forward-compatibility
 * (image rule #2 flat args) but is NOT yet deduplicated against — the
 * upstream API has no idempotency-key support (approved-plan risk R3/R4
 * territory); every call still triggers a fresh run. This is a known v1 gap.
 */
export function makeRunAgentOnPrUseCase(deps: {
  api: DevDigestApi;
  cache: RunPrCache;
  defaultWaitSeconds: number;
  maxWaitSeconds: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return async function runAgentOnPr(input: RunAgentOnPrInput): Promise<RunAgentOnPrOutput> {
    const repos = await deps.api.listRepos();
    const repo = repos.find((r) => r.full_name === input.repo);
    if (!repo) {
      throw new McpToolError(
        'repo_not_found',
        `Repo '${input.repo}' not found in DevDigest — it must be added/imported in the app before it can be reviewed.`,
      );
    }

    const agents = await deps.api.listAgents({ enabledOnly: false });
    const needle = input.agent.trim().toLowerCase();
    const agent = agents.find((a) => a.id === input.agent || a.name.toLowerCase() === needle);
    if (!agent) {
      throw new McpToolError(
        'agent_not_found',
        `Agent '${input.agent}' not found — call list_agents to see valid agents.`,
      );
    }

    const pulls = await deps.api.listPulls(repo.id);
    const pull = pulls.find((p) => p.number === input.pr_number);
    if (!pull?.id) {
      throw new McpToolError(
        'pull_request_not_found',
        `PR #${input.pr_number} in '${input.repo}' not found — confirm the repo is imported and the PR number is correct.`,
      );
    }
    const prId = pull.id;

    let runs;
    try {
      runs = await deps.api.triggerReview(prId, agent.id);
    } catch (err) {
      throw mapTriggerError(err, input);
    }
    const run = runs[0];
    if (!run) {
      throw new McpToolError(
        'invalid_run_request',
        `DevDigest accepted the request but returned no run for agent '${input.agent}' on PR #${input.pr_number}.`,
      );
    }
    deps.cache.remember(run.run_id, prId);

    const waitSeconds = clamp(
      input.wait_seconds ?? deps.defaultWaitSeconds,
      1,
      deps.maxWaitSeconds,
    );
    const deadline = waitSeconds * 1000;
    let elapsed = 0;
    while (elapsed < deadline) {
      await sleep(POLL_INTERVAL_MS);
      elapsed += POLL_INTERVAL_MS;
      const runRows = await deps.api.listRuns(prId);
      const current = runRows.find((r) => r.run_id === run.run_id);
      if (current && current.status !== 'running') {
        return await finalizeOutcome(deps.api, prId, run.run_id, current.status, current.error);
      }
    }

    return {
      run_id: run.run_id,
      status: 'running',
      verdict: null,
      findings: [],
      next_action: `Call get_findings with run_id='${run.run_id}' to poll for the result.`,
    };
  };
}

async function finalizeOutcome(
  api: DevDigestApi,
  prId: string,
  runId: string,
  status: string | null,
  error: string | null,
): Promise<RunAgentOnPrOutput> {
  if (status === 'failed' || status === 'cancelled') {
    return {
      run_id: runId,
      status,
      error: error ?? `Review run ${status}.`,
      next_action: 'Inspect the run in the DevDigest app, or call run_agent_on_pr again to retry.',
    };
  }
  const reviews = await api.listReviews(prId);
  const review = reviews.find((r) => r.run_id === runId);
  return {
    run_id: runId,
    status: 'done',
    verdict: review?.verdict ?? null,
    findings: (review?.findings ?? []).map(narrowFinding),
    next_action: null,
  };
}

function mapTriggerError(err: unknown, input: RunAgentOnPrInput): McpToolError {
  if (err instanceof UpstreamHttpError) {
    if (err.status === 429) {
      return new McpToolError(
        'rate_limited',
        'Review rate limit hit (10 requests/min) — wait a bit and retry.',
      );
    }
    return new McpToolError(
      'invalid_run_request',
      `Could not start a review for agent '${input.agent}' on PR #${input.pr_number}: ${err.message}`,
    );
  }
  return new McpToolError('invalid_run_request', `Could not start the review: ${(err as Error).message}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
