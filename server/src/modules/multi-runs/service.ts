import type {
  AgentRunEstimate,
  LatestMultiRunResponse,
  MultiRunDocument,
  ReviewRunTarget,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from '../reviews/repository.js';
import { ReviewRunExecutor, type Logger } from '../reviews/run-executor.js';
import { computeGroups } from './grouping.js';
import {
  computeTotals,
  estimateRowToDto,
  laneToAgent,
  laneToGroupingAgent,
  latestRefFromRow,
} from './helpers.js';
import { MultiRunRepository, type LatestScope } from './repository.js';

/**
 * Multi-Agent Review — application ring.
 *
 * Owns the multi-run use-cases: launching an explicit agent set as ONE grouped
 * fan-out, assembling the result document, serving pre-run estimates, and
 * resolving "the most recent multi-run for this scope".
 *
 * Deliberately a SEPARATE module rather than an extension of `ReviewService`:
 * the review module's finding-action service and helper are read-only for this
 * feature, so the resolve/create/link logic lives here and reuses the review
 * module only through its repository and its background executor — both
 * untouched.
 */
export class MultiRunService {
  private repo: MultiRunRepository;
  private reviewRepo: ReviewRepository;
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new MultiRunRepository(container.db);
    this.reviewRepo = new ReviewRepository(container.db);
    this.executor = new ReviewRunExecutor(container, this.reviewRepo, container.agentsRepo);
  }

  // ===========================================================================
  // Launch
  // ===========================================================================

  /**
   * Launch a fan-out over an EXPLICIT agent set: one `multi_agent_runs` row,
   * one `agent_runs` row per resolved agent linked to it, then the same
   * fire-and-forget background execution the legacy path uses (the HTTP
   * response returns immediately with the run ids + the multi-run id).
   *
   * The whole request is accepted or rejected atomically: repeated ids collapse
   * to one target, and an id that does not resolve to an ENABLED agent in the
   * caller's workspace rejects the request BEFORE anything is created — a
   * foreign or disabled id must never be silently skipped, because that
   * resolution is this feature's access-control boundary.
   */
  async launch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{ runs: ReviewRunTarget[]; multiRunId: string }> {
    // A repeated agent id within one request is a single target.
    const requested = [...new Set(agentIds)];
    if (requested.length === 0) {
      throw new AppError('invalid_run_request', 'agentIds must contain at least one agent id', 400);
    }

    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const byId = new Map(enabled.map((a) => [a.id, a]));
    const unresolved = requested.filter((id) => !byId.has(id));
    if (unresolved.length > 0) {
      throw new AppError(
        'unknown_agent',
        'One or more agent ids do not resolve to an enabled agent in this workspace',
        400,
        { agent_ids: unresolved },
      );
    }
    const targets: AgentRow[] = requested.map((id) => byId.get(id)!);

    // Resolve the PR/repo BEFORE writing the grouping row, so a bad prId can
    // never leave an orphaned multi_agent_runs row behind.
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const multiRun = await this.repo.createMultiRun(workspaceId, prId);

    const runs: ReviewRunTarget[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.reviewRepo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiRunId: multiRun.id,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget, exactly as the legacy launch path does: the executor
    // loads the shared pre-work once and fans the agents out concurrently.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error(
        { prId, multiRunId: multiRun.id, err: (err as Error).message },
        'multi-run: background execution crashed',
      );
    });

    return { runs, multiRunId: multiRun.id };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  /**
   * The whole multi-run as one document. 404s when the id is unresolvable or
   * belongs to another workspace — the two are indistinguishable on purpose.
   *
   * An in-progress multi-run returns a COMPLETE document carrying non-terminal
   * run states, never a partial or fabricated one; the client polls this same
   * shape until every lane is terminal.
   */
  async getDocument(workspaceId: string, multiRunId: string): Promise<MultiRunDocument> {
    const row = await this.repo.getMultiRun(workspaceId, multiRunId);
    if (!row) throw new NotFoundError('Multi-run not found');

    const lanes = await this.repo.runsForMultiRun(workspaceId, row.id);
    return {
      id: row.id,
      ran_at: row.ranAt.toISOString(),
      pr: { id: row.prId, number: row.prNumber, title: row.prTitle },
      agents: lanes.map(laneToAgent),
      // Grouping is computed by the module's pure, zero-I/O core over the
      // already-loaded lanes — no extra query, no model call.
      groups: computeGroups(lanes.map(laneToGroupingAgent)),
      totals: computeTotals(lanes),
    };
  }

  /** Pre-run estimates for every enabled agent (one grouped aggregate query). */
  async estimates(workspaceId: string): Promise<AgentRunEstimate[]> {
    const rows = await this.repo.estimatesForWorkspace(workspaceId);
    return rows.map(estimateRowToDto);
  }

  /**
   * The most recent multi-run for a scope.
   *
   * "This scope has no multi-run yet" is a NORMAL answer — `{ multi_run: null }`
   * with a 2xx — so the client can pick its landing state in one round trip.
   * It is explicitly NOT a `NotFoundError`: 404 stays reserved for an
   * unresolvable or cross-workspace EXPLICIT multi-run id in `getDocument`.
   */
  async latestMultiRun(workspaceId: string, scope: LatestScope): Promise<LatestMultiRunResponse> {
    const row = await this.repo.latestMultiRun(workspaceId, scope);
    return { multi_run: row ? latestRefFromRow(row) : null };
  }
}
