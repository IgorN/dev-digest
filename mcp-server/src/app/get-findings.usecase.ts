import type { DevDigestApi } from '../ports/devdigest-api.js';
import { McpToolError } from '../domain/errors.js';
import { filterAndLimitFindings, type NarrowFinding } from '../domain/shape.js';
import type { Severity, FindingCategory } from '../vendor/shared/findings.js';
import type { RunPrCache } from './run-pr-cache.js';

export interface GetFindingsInput {
  run_id: string;
  severity?: Severity;
  category?: FindingCategory;
  limit?: number;
}

export interface GetFindingsOutput {
  run_id: string;
  status: string;
  verdict: string | null;
  total_findings: number;
  returned: number;
  findings: NarrowFinding[];
  error?: string;
}

/** Application ring — the poll side of the run/poll split (best practice #6:
 *  the currently-correct fallback for long-running MCP operations, since the
 *  formal MCP Tasks primitive is still experimental). */
export function makeGetFindingsUseCase(deps: { api: DevDigestApi; cache: RunPrCache }) {
  return async function getFindings(input: GetFindingsInput): Promise<GetFindingsOutput> {
    const prId = deps.cache.prFor(input.run_id);
    if (!prId) {
      throw new McpToolError(
        'run_not_found',
        `Run '${input.run_id}' not found — start a review with run_agent_on_pr first (the MCP server may have restarted since that run started).`,
      );
    }

    const runs = await deps.api.listRuns(prId);
    const run = runs.find((r) => r.run_id === input.run_id);
    if (!run) {
      throw new McpToolError(
        'run_not_found',
        `Run '${input.run_id}' not found — start a review with run_agent_on_pr first.`,
      );
    }

    const status = run.status ?? 'running';
    if (status === 'running') {
      return {
        run_id: input.run_id,
        status: 'running',
        verdict: null,
        total_findings: 0,
        returned: 0,
        findings: [],
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        run_id: input.run_id,
        status,
        verdict: null,
        total_findings: 0,
        returned: 0,
        findings: [],
        error: run.error ?? `Review run ${status}.`,
      };
    }

    const reviews = await deps.api.listReviews(prId);
    const review = reviews.find((r) => r.run_id === input.run_id);
    const narrowed = filterAndLimitFindings(review?.findings ?? [], {
      severity: input.severity,
      category: input.category,
      limit: input.limit,
    });
    return {
      run_id: input.run_id,
      status: 'done',
      verdict: review?.verdict ?? null,
      ...narrowed,
    };
  };
}
