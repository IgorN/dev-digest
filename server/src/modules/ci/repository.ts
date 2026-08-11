import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn } from '@devdigest/shared';
import type { PostAs } from './types.js';

/**
 * INFRASTRUCTURE — the ONLY file under `modules/ci/` that imports Drizzle or
 * `db/schema`. Every query is workspace-scoped: a CI run or installation
 * belonging to another workspace must be unreachable, not merely unrendered.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;
export type AgentRow = typeof t.agents.$inferSelect;

/** An installation plus the derived facts the agent CI tab renders (AC-57/58). */
export interface InstallationWithActivity {
  installation: CiInstallationRow;
  /** Status of the MOST RECENT ingested run; null ⇒ pending (AC-58). */
  lastStatus: string | null;
  lastActivityAt: Date | null;
}

export interface UpsertInstallationInput {
  workspaceId: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  postAs: PostAs;
  triggers: string[];
  baseBranch: string;
  /** Only used on INSERT — an existing row keeps its pinned path (AC-3). */
  manifestPath: string;
  workflowPath: string;
  prUrl: string | null;
  exportedCiFailOn: CiFailOn;
}

export interface InsertCiRunInput {
  workspaceId: string;
  ciInstallationId: string;
  agentRunId: string | null;
  githubRunId: string;
  repo: string;
  agentName: string | null;
  prTitle: string | null;
  prNumber: number | null;
  ranAt: Date | null;
  status: string;
  durationMs: number | null;
  findingsCount: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  githubUrl: string | null;
}

export interface InsertCiAgentRunInput {
  workspaceId: string;
  agentId: string | null;
  prId: string | null;
  ranAt: Date;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  status: string;
  findingsCount: number | null;
  costUsd: number | null;
}

export interface CiRunFilters {
  agentId?: string;
  repo?: string;
  status?: string;
  since?: Date;
  limit?: number;
}

/** One joined CI-run row: the persisted columns plus its owning agent's identity. */
export interface CiRunWithAgent {
  run: CiRunRow;
  agentId: string | null;
  /** The agent's CURRENT name; the row's own `agentName` is the ingest snapshot. */
  agentLiveName: string | null;
}

/** R11: the runs list is capped so one page can never become an unbounded scan. */
export const CI_RUNS_DEFAULT_LIMIT = 200;

export class CiRepository {
  constructor(private db: Db) {}

  // ---- repositories (the write path's access-control boundary) ------------

  /**
   * AC-66 — the target repository decides where the server's GitHub token
   * WRITES, so it is resolved against the caller's own workspace rather than
   * accepted as free text. A miss here must block the export.
   */
  async findRepoByFullName(
    workspaceId: string,
    fullName: string,
  ): Promise<{ id: string; fullName: string; defaultBranch: string } | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;
  }

  // ---- installations ------------------------------------------------------

  async findInstallation(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
        ),
      );
    return row;
  }

  /** AC-68 — "is this repository already claimed?", regardless of which agent. */
  async findInstallationByRepo(
    workspaceId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.workspaceId, workspaceId),
          eq(t.ciInstallations.repo, repo),
        ),
      );
    return row;
  }

  async findInstallationById(
    workspaceId: string,
    id: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(eq(t.ciInstallations.workspaceId, workspaceId), eq(t.ciInstallations.id, id)),
      );
    return row;
  }

  /**
   * The agent CI tab's rows, in ONE statement (AC-4's "with no live GitHub
   * call", R11's 300 ms budget): a `DISTINCT ON` lateral of each installation's
   * most recent run, left-joined — never one query per installation.
   */
  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<InstallationWithActivity[]> {
    const latest = this.latestRunPerInstallation();
    const rows = await this.db
      .select({
        installation: t.ciInstallations,
        lastStatus: latest.status,
        lastActivityAt: latest.ranAt,
      })
      .from(t.ciInstallations)
      .leftJoin(latest, eq(latest.installationId, t.ciInstallations.id))
      .where(
        and(
          eq(t.ciInstallations.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
        ),
      )
      .orderBy(asc(t.ciInstallations.installedAt));
    return rows.map((r) => ({
      installation: r.installation,
      lastStatus: r.lastStatus ?? null,
      lastActivityAt: r.lastActivityAt ?? null,
    }));
  }

  /** Every installation in the workspace, joined to its agent — the ingest input. */
  async listInstallationsWithAgent(
    workspaceId: string,
  ): Promise<{ installation: CiInstallationRow; agent: AgentRow | null }[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations, agent: t.agents })
      .from(t.ciInstallations)
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.ciInstallations.workspaceId, workspaceId))
      .orderBy(asc(t.ciInstallations.installedAt));
    return rows.map((r) => ({ installation: r.installation, agent: r.agent ?? null }));
  }

  private latestRunPerInstallation() {
    return this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId], {
        installationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .orderBy(t.ciRuns.ciInstallationId, sql`${t.ciRuns.ranAt} desc nulls last`)
      .as('latest_ci_run');
  }

  /**
   * Insert-or-update keyed by the DB-level unique index on (agent_id, repo)
   * (AC-1). Two invariants live here and nowhere else:
   *  - `manifest_path` is NEVER written on the update branch (AC-3): it is
   *    pinned at first install, because the runner hard-fails on more than one
   *    manifest and the commit API cannot delete a file;
   *  - `workflow_version` increments by exactly one on every export, including
   *    an unchanged one (AC-32) — a monotonic counter, not a content hash.
   */
  async upsertInstallation(input: UpsertInstallationInput): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
        postAs: input.postAs,
        triggers: input.triggers,
        baseBranch: input.baseBranch,
        manifestPath: input.manifestPath,
        workflowPath: input.workflowPath,
        workflowVersion: 1,
        prUrl: input.prUrl,
        exportedCiFailOn: input.exportedCiFailOn,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: {
          targetType: input.targetType,
          postAs: input.postAs,
          triggers: input.triggers,
          baseBranch: input.baseBranch,
          workflowPath: input.workflowPath,
          prUrl: input.prUrl,
          exportedCiFailOn: input.exportedCiFailOn,
          // References the EXISTING row's value inside ON CONFLICT DO UPDATE.
          workflowVersion: sql`${t.ciInstallations.workflowVersion} + 1`,
        },
      })
      .returning();
    return row!;
  }

  async touchLastIngest(installationId: string, at: Date): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ lastIngestAt: at })
      .where(eq(t.ciInstallations.id, installationId));
  }

  // ---- runs ---------------------------------------------------------------

  /** AC-5 — the ingest idempotency lookup. */
  async findCiRunByGithubRunId(
    installationId: string,
    githubRunId: string,
  ): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installationId),
          eq(t.ciRuns.githubRunId, githubRunId),
        ),
      );
    return row;
  }

  /**
   * Every already-stored Actions run id for an installation with its status, in
   * one statement. A run stored as `running` is deliberately re-examined on the
   * next Refresh (the spec's "re-checked on the next Refresh", AC-49); a
   * terminal one is skipped, which is what makes Refresh idempotent (AC-5).
   */
  async storedRunStatuses(installationId: string): Promise<Map<string, string | null>> {
    const rows = await this.db
      .select({ id: t.ciRuns.githubRunId, status: t.ciRuns.status })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  /**
   * Insert-or-update keyed by (installation, Actions run id) — AC-5's
   * idempotency key. The update branch exists only so a row first seen as
   * `running` can be completed on a later Refresh; a terminal row is never
   * re-offered by the ingest.
   */
  async upsertCiRun(input: InsertCiRunInput): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({ ...input, source: 'ci' })
      .onConflictDoUpdate({
        target: [t.ciRuns.ciInstallationId, t.ciRuns.githubRunId],
        set: {
          agentRunId: input.agentRunId,
          agentName: input.agentName,
          prTitle: input.prTitle,
          prNumber: input.prNumber,
          ranAt: input.ranAt,
          status: input.status,
          durationMs: input.durationMs,
          findingsCount: input.findingsCount,
          critical: input.critical,
          warning: input.warning,
          suggestion: input.suggestion,
          costUsd: input.costUsd,
          githubUrl: input.githubUrl,
        },
      })
      .returning();
    return row;
  }

  /**
   * Write the ingested review into the EXISTING run model (AC-36/AC-37) rather
   * than a parallel CI one, so every per-agent aggregate covers CI runs with no
   * backfill. Written from THIS repository, never through the reviews module.
   */
  async insertCiAgentRun(input: InsertCiAgentRunInput): Promise<string> {
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({ ...input, source: 'ci' })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  /** AC-38 — resolve the ingested PR number against PRs already imported here. */
  async findPullRequest(
    workspaceId: string,
    repoFullName: string,
    prNumber: number,
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.repos.fullName, repoFullName),
          eq(t.pullRequests.number, prNumber),
        ),
      );
    return row;
  }

  /**
   * The CI Runs table, newest first, in ONE statement. The filter facets the
   * chip row needs are derived from THIS result set by the caller — the spec's
   * contract is explicitly "the distinct agents and repositories present in the
   * result set", so no second round trip and no N+1.
   */
  async listCiRuns(
    workspaceId: string,
    filters: CiRunFilters = {},
  ): Promise<CiRunWithAgent[]> {
    const clauses = [eq(t.ciRuns.workspaceId, workspaceId)];
    if (filters.repo) clauses.push(eq(t.ciRuns.repo, filters.repo));
    if (filters.status) clauses.push(eq(t.ciRuns.status, filters.status));
    if (filters.since) clauses.push(gte(t.ciRuns.ranAt, filters.since));
    if (filters.agentId) clauses.push(eq(t.ciInstallations.agentId, filters.agentId));

    const rows = await this.db
      .select({ run: t.ciRuns, agentId: t.ciInstallations.agentId, agentName: t.agents.name })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(...clauses))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(filters.limit ?? CI_RUNS_DEFAULT_LIMIT);

    return rows.map((r) => ({
      run: r.run,
      agentId: r.agentId ?? null,
      agentLiveName: r.agentName ?? null,
    }));
  }
}
