import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    clonePath: text('clone_path'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    // L03 conventions-extractor: when the repo was last scanned for conventions
    // and how many files were sampled — drives the "Detected from N files · last
    // scan …" header. Null until the first extract.
    conventionsScannedAt: timestamp('conventions_scanned_at', { withTimezone: true }),
    conventionsSampleCount: integer('conventions_sample_count'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('repos_ws_fullname_uq').on(t.workspaceId, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
  }),
);
