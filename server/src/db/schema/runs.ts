import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    /**
     * The multi-agent fan-out this run belongs to, when it was launched with an
     * explicit agent set. NULLABLE on purpose: every legacy row, and every run
     * launched through the single-agent / run-all paths, has none and no
     * backfill is performed. `on delete set null` (never cascade) so removing a
     * grouping row can only ever unlink runs, never destroy run history.
     * Forward reference — `multiAgentRuns` is declared below in this file; the
     * arrow-function form is resolved lazily, so the ordering is fine.
     */
    multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, {
      onDelete: 'set null',
    }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    /** USD cost of the LLM call(s) for this run; null when the provider doesn't expose usage. */
    costUsd: doublePrecision('cost_usd'),
  },
  // Postgres does NOT auto-index a foreign-key column; the multi-run result
  // document is read by "every run of THIS multi-run", so the index is required.
  (t) => ({ multiRunIdx: index('agent_runs_multi_run_idx').on(t.multiRunId) }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
