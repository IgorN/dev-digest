import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, integer, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  // L03 conventions-extractor: a coarse bucket the model assigns
  // (naming / error-handling / structure / async / imports / testing …).
  category: text('category'),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  // Verified line range of the evidence in `evidence_path` — drives the
  // clickable GitHub blob deep-link.
  evidenceStartLine: integer('evidence_start_line'),
  evidenceEndLine: integer('evidence_end_line'),
  confidence: doublePrecision('confidence'),
  // null = undecided (shown as a candidate), true = accepted, false = rejected.
  accepted: boolean('accepted'),
});
