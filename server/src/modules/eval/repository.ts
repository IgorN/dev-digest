import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind, EvalRun } from '@devdigest/shared';

/**
 * Eval — data-access. Owns `eval_cases` and `eval_runs`. Every query is
 * workspace-scoped either directly (`eval_cases.workspace_id`) or, for
 * `eval_runs` (which carries no `workspace_id`/owner column of its own), by
 * joining through `eval_cases` to resolve it — per this codebase's tenancy
 * convention (`onion-architecture`), a cross-workspace id must resolve as
 * not-found, never leak.
 *
 * Returns plain typed rows/DTOs only. Contract-shaping (the vendored
 * `EvalCase`/`EvalRunRecord`/`EvalDashboard` zod types) happens in
 * `service.ts`, not here — mirrors the `agents`/`reviews` repositories'
 * layering.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface NewEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/**
 * One RUN BATCH, aggregated from its per-case `eval_runs` rows (see
 * `groupRunsIntoBatches` for how the aggregation is computed). `caseCount` is
 * the number of case-executions folded into this batch; recall/precision/
 * citation_accuracy are means over rows that recorded a value, `passRate` is
 * the fraction of rows with `pass === true` over rows with `pass !== null`,
 * `costUsd` is the sum of non-null per-row costs (null when no row priced).
 */
export interface EvalRunBatchRow {
  runBatchId: string;
  agentVersion: number;
  ranAt: Date;
  recall: number;
  precision: number;
  citationAccuracy: number;
  passRate: number;
  costUsd: number | null;
  caseCount: number;
}

/** A batch row plus the owner (agent/skill) it belongs to — for the
 *  workspace-wide, cross-owner "recent runs" view. Resolved only as far as
 *  `eval_cases.owner_kind`/`owner_id`; the human-readable owner NAME (e.g. an
 *  agent's `name`) is not this module's data, and is enriched by the caller
 *  (`service.ts`, via the agents module). */
export interface EvalRunBatchWithOwnerRow extends EvalRunBatchRow {
  ownerKind: EvalOwnerKind;
  ownerId: string;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases -----------------------------------------------------

  async listByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async createCase(values: NewEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined
          ? { inputFiles: patch.inputFiles as object | null }
          : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object | null } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object | null }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Delete a case (scoped to workspace). `eval_runs` for it cascade
   *  (`case_id` FK is `onDelete: 'cascade'`). Returns false if no such case
   *  existed in the workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_runs --------------------------------------------------------

  /** Insert one `eval_runs` row for one case's execution within a batch.
   *  `pass` is derived from the scored `EvalRun`'s trace counts (null only
   *  when the run recorded zero traces, which should not happen in practice
   *  for a single-case run); `actual_output` persists the run's `per_trace`
   *  detail, the richest already-built record of what the case produced. */
  async insertRun(
    caseId: string,
    runBatchId: string,
    agentVersion: number,
    result: EvalRun,
  ): Promise<EvalRunRow> {
    const pass =
      result.traces_total > 0 ? result.traces_passed === result.traces_total : null;
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId,
        runBatchId,
        agentVersion,
        actualOutput: result.per_trace as object,
        pass,
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: result.duration_ms,
        costUsd: result.cost_usd,
      })
      .returning();
    return row!;
  }

  /** The most recent `eval_runs` row for one case (used by the case editor's
   *  "Last run" status strip). Caller is responsible for having already
   *  resolved the case's workspace ownership (e.g. via `getCase`). */
  async latestRunForCase(caseId: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, caseId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return row;
  }

  /** All `eval_runs` rows sharing one `run_batch_id` (e.g. for a Compare-runs
   *  modal that needs every per-case row of two specific batches). Caller is
   *  responsible for having already resolved batch ownership. */
  async runsForBatch(runBatchId: string): Promise<EvalRunRow[]> {
    return this.db.select().from(t.evalRuns).where(eq(t.evalRuns.runBatchId, runBatchId));
  }

  /**
   * Recent run BATCHES for one owner (agent/skill), newest first, capped at
   * `limit`.
   *
   * Batch-grouping approach: fetch every `eval_runs` row for the owner's
   * cases in ONE query, then group by `run_batch_id` in memory (`groupRuns`),
   * rather than a SQL `GROUP BY run_batch_id`. Chosen over SQL grouping
   * because (a) this table's expected size is small (one row per case per
   * run, bounded by a workspace's case count × its run history — not an
   * unbounded log table), (b) an in-memory group avoids getting a
   * multi-aggregate `GROUP BY` (avg/sum across 6 differently-typed nullable
   * columns, plus picking a representative timestamp) subtly wrong in SQL on
   * the first attempt, and (c) it mirrors this codebase's own precedent for
   * "join/fetch once, then group in memory" — `ReviewRepository.reviewsForPull`
   * (`smart-diff/service.ts` is the consumer) — which is the closest existing
   * shape to this "group a flat row set into parent buckets" problem.
   */
  async recentBatchesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
    limit: number,
  ): Promise<EvalRunBatchRow[]> {
    const cases = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    if (cases.length === 0) return [];

    const caseIds = cases.map((c) => c.id);
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds));

    return groupRunsIntoBatches(runs).slice(0, limit);
  }

  /**
   * Recent run BATCHES across every owner (agent/skill) in the workspace,
   * newest first, capped at `limit` — for the workspace-wide dashboard's
   * cross-agent "recent runs" table. Joined through `eval_cases` (one query)
   * to resolve which owner each `eval_runs` row belongs to, then grouped in
   * memory the same way as `recentBatchesForOwner` (see that method's doc
   * comment for why in-memory grouping was chosen over SQL `GROUP BY`).
   */
  async recentBatchesWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<EvalRunBatchWithOwnerRow[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, ownerKind: t.evalCases.ownerKind, ownerId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.workspaceId, workspaceId));

    const byBatch = new Map<string, { runs: EvalRunRow[]; ownerKind: EvalOwnerKind; ownerId: string }>();
    for (const { run, ownerKind, ownerId } of rows) {
      const bucket = byBatch.get(run.runBatchId);
      if (bucket) bucket.runs.push(run);
      else byBatch.set(run.runBatchId, { runs: [run], ownerKind, ownerId });
    }

    const batches: EvalRunBatchWithOwnerRow[] = [...byBatch.values()].map(
      ({ runs, ownerKind, ownerId }) => ({
        ...aggregateBatch(runs),
        ownerKind,
        ownerId,
      }),
    );
    batches.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
    return batches.slice(0, limit);
  }
}

/** Group a flat list of `eval_runs` rows by `run_batch_id` and aggregate each
 *  group into one `EvalRunBatchRow`, sorted newest-batch-first. */
function groupRunsIntoBatches(runs: EvalRunRow[]): EvalRunBatchRow[] {
  const byBatch = new Map<string, EvalRunRow[]>();
  for (const run of runs) {
    const bucket = byBatch.get(run.runBatchId);
    if (bucket) bucket.push(run);
    else byBatch.set(run.runBatchId, [run]);
  }
  const batches = [...byBatch.values()].map(aggregateBatch);
  batches.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  return batches;
}

/** Aggregate one batch's per-case rows into one `EvalRunBatchRow`. `ranAt` is
 *  the MIN timestamp across the batch's rows (when the batch started) —
 *  all rows in a batch are inserted by the same `runBatch` call in quick
 *  succession, so MIN vs MAX is not materially different, but MIN is chosen
 *  as the more intuitive "this batch ran at ‹time›" reading. Mean metrics are
 *  computed over rows that recorded a value (nullable columns); `costUsd` is
 *  the sum of non-null costs, or null when no row in the batch was priced. */
function aggregateBatch(runs: EvalRunRow[]): EvalRunBatchRow {
  const first = runs[0]!;
  const ranAt = runs.reduce((min, r) => (r.ranAt < min ? r.ranAt : min), first.ranAt);
  const agentVersion = Math.max(...runs.map((r) => r.agentVersion));

  const recalls = runs.map((r) => r.recall).filter((v): v is number => v != null);
  const precisions = runs.map((r) => r.precision).filter((v): v is number => v != null);
  const citationAccuracies = runs
    .map((r) => r.citationAccuracy)
    .filter((v): v is number => v != null);
  const passes = runs.map((r) => r.pass).filter((v): v is boolean => v != null);
  const costs = runs.map((r) => r.costUsd).filter((v): v is number => v != null);

  return {
    runBatchId: first.runBatchId,
    agentVersion,
    ranAt,
    recall: mean(recalls),
    precision: mean(precisions),
    citationAccuracy: mean(citationAccuracies),
    passRate: passes.length === 0 ? 0 : passes.filter(Boolean).length / passes.length,
    costUsd: costs.length === 0 ? null : costs.reduce((sum, c) => sum + c, 0),
    caseCount: runs.length,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}
