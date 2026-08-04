import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { workspaces } from './core';
import { agentRuns } from './runs';

/**
 * Export-to-CI persistence.
 *
 * `ci_installations` is "this agent is deployed to this repository's CI": one
 * row per (agent, repo) pair, enforced by a DB-level unique index (AC-1) rather
 * than by application code. `ci_runs` is one row per GitHub Actions workflow run
 * that was ingested back on Refresh, keyed for idempotency by
 * (installation, github_run_id) (AC-5).
 *
 * `agent_runs` is deliberately NOT extended: its `source` column already accepts
 * `'ci'` and its duration/cost/findings columns already exist, so an ingested CI
 * review lands in the SAME run model a local review does (AC-37) and every
 * existing per-agent aggregate covers it with no backfill.
 */

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Explicit owning workspace so installation reads scope directly, not via a join. */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    /** How the runner posts its result; travels to CI as `DEVDIGEST_POST_AS`. */
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    /** `pull_request` event types the generated workflow listens on. */
    triggers: jsonb('triggers')
      .$type<string[]>()
      .notNull()
      .default(['opened', 'synchronize']),
    baseBranch: text('base_branch').notNull().default('main'),
    /**
     * PINNED at first install and never re-derived from the agent's name (AC-3):
     * the runner hard-fails on more than one manifest and the commit API cannot
     * delete, so a rename would otherwise brick the installation. The `''`
     * default exists only so the ALTER is non-interactive — every write path
     * supplies a real path.
     */
    manifestPath: text('manifest_path').notNull().default(''),
    workflowPath: text('workflow_path')
      .notNull()
      .default('.github/workflows/devdigest-review.yml'),
    /** Monotonic export counter, incremented on every successful install (AC-32). */
    workflowVersion: integer('workflow_version').notNull().default(0),
    prUrl: text('pr_url'),
    lastIngestAt: timestamp('last_ingest_at', { withTimezone: true }),
    /**
     * The gate policy as it was written into the committed manifest. Compared
     * against the agent's CURRENT `ci_fail_on` to surface policy drift (AC-60) —
     * the exported value travels inside the commit and cannot be read back.
     */
    exportedCiFailOn: text('exported_ci_fail_on', {
      enum: ['never', 'critical', 'warning', 'any'],
    }),
  },
  (t) => ({
    // AC-1: one installation per (agent, repository), enforced by the database.
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
    wsIdx: index('ci_installations_ws_idx').on(t.workspaceId),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The `agent_runs` row this ingest produced (`source='ci'`). Nullable (AC-4). */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    /** GitHub Actions run id — the ingest idempotency key (AC-5). */
    githubRunId: text('github_run_id').notNull().default(''),
    repo: text('repo'),
    /** Snapshot of the agent's name at ingest time; survives agent deletion. */
    agentName: text('agent_name'),
    /** Snapshot of the pull-request title from the workflow-run payload. */
    prTitle: text('pr_title'),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    durationMs: integer('duration_ms'),
    findingsCount: integer('findings_count'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
  },
  (t) => ({
    // AC-5: exactly one row per (installation, workflow run).
    runUq: uniqueIndex('ci_runs_installation_github_run_uq').on(
      t.ciInstallationId,
      t.githubRunId,
    ),
    // Postgres does not auto-index FK columns.
    wsIdx: index('ci_runs_ws_idx').on(t.workspaceId),
    agentRunIdx: index('ci_runs_agent_run_idx').on(t.agentRunId),
  }),
);
