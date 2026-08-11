import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { SUCCESSFUL_RUN_STATUS } from './constants.js';

/**
 * Multi-run data access — the ONLY file in this module that imports Drizzle or
 * touches `db/schema`. Every query is workspace-scoped: a cross-workspace id
 * must resolve as "not found" here and never leak upward (the 404-vs-empty
 * decision itself belongs to `service.ts`, not to this layer).
 *
 * Returns plain typed rows only; contract shaping (the vendored
 * `MultiRunDocument` / `AgentRunEstimate` / `LatestMultiRunRef` types) happens
 * in `service.ts`, mirroring the `eval` and `reviews` repositories.
 */

export interface MultiRunRow {
  id: string;
  workspaceId: string;
  ranAt: Date;
  prId: string;
  prNumber: number;
  prTitle: string;
}

/** One agent lane of a multi-run: its run, its agent, its review, its findings. */
export interface MultiRunLaneRow {
  run: typeof t.agentRuns.$inferSelect;
  agentName: string | null;
  review: typeof t.reviews.$inferSelect | null;
  findings: (typeof t.findings.$inferSelect)[];
}

/** Raw per-agent aggregate backing `AgentRunEstimate`. */
export interface AgentEstimateRow {
  agentId: string;
  agentName: string;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  durationSampleCount: number;
  costSampleCount: number;
  lastSummary: string | null;
}

/** "Newest multi-run for a scope" — exactly one of `repoId` / `prId`. */
export type LatestScope = { repoId: string; prId?: undefined } | { prId: string; repoId?: undefined };

export class MultiRunRepository {
  constructor(private db: Db) {}

  // ---- multi_agent_runs ---------------------------------------------------

  /** Create the grouping row for ONE explicit-agent-set launch. */
  async createMultiRun(workspaceId: string, prId: string): Promise<{ id: string; ranAt: Date }> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt });
    return row!;
  }

  /**
   * One multi-run with its PR identity. `undefined` when the id does not exist
   * OR belongs to another workspace — the two are deliberately indistinguishable
   * from here so a foreign id can only ever surface as a 404.
   */
  async getMultiRun(workspaceId: string, id: string): Promise<MultiRunRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        workspaceId: t.multiAgentRuns.workspaceId,
        ranAt: t.multiAgentRuns.ranAt,
        prId: t.pullRequests.id,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
    return row;
  }

  /**
   * Every run of a multi-run, with its agent name, its review and its findings.
   *
   * ONE joined query (`agent_runs → agents → reviews → findings`) grouped in
   * memory — the same "join/fetch once, then bucket" shape this codebase
   * already uses in `ReviewRepository.reviewsForPull` and
   * `EvalRepository.recentBatchesWorkspace`. `reviews.run_id` carries no FK but
   * is 1:0..1 per run, so the join fans out only over findings.
   *
   * Ordered `agent_runs.ran_at ASC, agent_runs.id ASC` — this IS the multi-run's
   * authoritative agent order (column order, tab order, group-cell order and
   * the client's accent-colour index all read it), so it must be total and
   * stable, hence the id tie-break.
   */
  async runsForMultiRun(workspaceId: string, multiRunId: string): Promise<MultiRunLaneRow[]> {
    const rows = await this.db
      .select({
        run: t.agentRuns,
        agentName: t.agents.name,
        review: t.reviews,
        finding: t.findings,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      // Workspace-scoped in its OWN right, not just via the caller having
      // validated ownership through `getMultiRun` first. Relying on call
      // ordering for tenant isolation is one refactor away from leaking another
      // workspace's runs; the predicate costs nothing and cannot be forgotten.
      .where(and(eq(t.agentRuns.multiRunId, multiRunId), eq(t.agentRuns.workspaceId, workspaceId)))
      .orderBy(asc(t.agentRuns.ranAt), asc(t.agentRuns.id), asc(t.findings.startLine));

    const lanes = new Map<string, MultiRunLaneRow>();
    for (const { run, agentName, review, finding } of rows) {
      let lane = lanes.get(run.id);
      if (!lane) {
        lane = { run, agentName: agentName ?? null, review: review ?? null, findings: [] };
        lanes.set(run.id, lane);
      }
      if (finding && !lane.findings.some((f) => f.id === finding.id)) lane.findings.push(finding);
    }
    return [...lanes.values()];
  }

  // ---- estimates ----------------------------------------------------------

  /**
   * Per-agent pre-run estimates for every ENABLED agent in the workspace, in
   * ONE grouped aggregate query (never one query per agent — that is an
   * explicit non-functional requirement).
   *
   * The join condition, not a WHERE clause, restricts the aggregated runs to
   * that workspace's SUCCESSFUL runs, so an agent with no qualifying history
   * still comes back (as a row of nulls/zeros) rather than disappearing.
   * Postgres `avg`/`count` ignore NULLs natively — which is exactly the
   * "duration and cost averages may have different denominators" semantics the
   * spec asks for, with no special-casing needed.
   *
   * `last_summary` rides along in the same aggregate: `reviews` joins 1:0..1 off
   * the run, so `array_agg(... ORDER BY created_at DESC)[1]` picks that agent's
   * newest non-null review summary without a second round trip.
   */
  async estimatesForWorkspace(workspaceId: string): Promise<AgentEstimateRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        avgDurationMs: sql<number | null>`avg(${t.agentRuns.durationMs})::float8`,
        avgCostUsd: sql<number | null>`avg(${t.agentRuns.costUsd})::float8`,
        durationSampleCount: sql<number>`count(${t.agentRuns.durationMs})::int`,
        costSampleCount: sql<number>`count(${t.agentRuns.costUsd})::int`,
        lastSummary: sql<string | null>`(array_agg(${t.reviews.summary} ORDER BY ${t.reviews.createdAt} DESC) FILTER (WHERE ${t.reviews.summary} IS NOT NULL))[1]`,
      })
      .from(t.agents)
      .leftJoin(
        t.agentRuns,
        and(
          eq(t.agentRuns.agentId, t.agents.id),
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, SUCCESSFUL_RUN_STATUS),
        ),
      )
      .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)))
      .groupBy(t.agents.id, t.agents.name)
      .orderBy(asc(t.agents.name));

    return rows.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      avgDurationMs: r.avgDurationMs ?? null,
      avgCostUsd: r.avgCostUsd ?? null,
      durationSampleCount: Number(r.durationSampleCount ?? 0),
      costSampleCount: Number(r.costSampleCount ?? 0),
      lastSummary: r.lastSummary ?? null,
    }));
  }

  // ---- latest-multi-run resolution ----------------------------------------

  /**
   * The most recent multi-run of a scope — a repository (the sidebar entry
   * point) or a single pull request (the PR-page timeline re-entry) — or
   * `undefined` when the scope has none.
   *
   * Ordered by the MULTI-RUN's own `ran_at`, never by any `agent_runs`
   * timestamp: the two can differ, and both acceptance criteria name the
   * multi-run's own timestamp explicitly. `id DESC` tie-breaks so "newest" stays
   * deterministic when two rows share a timestamp. ONE `LIMIT 1` query per call.
   *
   * `undefined` here is a NORMAL result, not an error — the 2xx-with-null
   * vs 404 distinction is enforced one layer up, in `service.ts`.
   */
  async latestMultiRun(workspaceId: string, scope: LatestScope): Promise<MultiRunRow | undefined> {
    const scoped =
      scope.repoId !== undefined
        ? eq(t.pullRequests.repoId, scope.repoId)
        : eq(t.multiAgentRuns.prId, scope.prId);

    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        workspaceId: t.multiAgentRuns.workspaceId,
        ranAt: t.multiAgentRuns.ranAt,
        prId: t.pullRequests.id,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), scoped))
      .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
      .limit(1);
    return row;
  }
}
