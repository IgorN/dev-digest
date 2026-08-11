import { and, eq, sql } from 'drizzle-orm';
import { Onboarding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { RepoRow } from '../../db/rows.js';

/**
 * Persistence for the onboarding tour — the ONLY Drizzle file in this module.
 *
 * `onboarding` is keyed solely by `repoId` (its PK — no separate `id`), so the
 * upsert conflict target is `repoId` and there is one row per repo
 * (last-write-wins).
 */
/**
 * Merge the DB `generated_at` column (the source of truth for the tour's
 * timestamp) into the parsed payload. The persisted `json` never carries its own
 * `generated_at` — `buildSkeleton`/`generate` leave it null and the column is
 * stamped on upsert — so every read/write path must fold the column back in, or
 * the client's "last refreshed" staleness header renders a placeholder (AC-19).
 */
function withGeneratedAt(json: unknown, generatedAt: Date): Onboarding {
  return { ...Onboarding.parse(json), generated_at: generatedAt.toISOString() };
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped repo lookup — mirrors the `context` module. Used for AC-21 scoping and no-clone detection. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Read the persisted tour for a repo, or `undefined` when none has been
   * generated. `Onboarding.parse` tolerates old rows because the staleness /
   * index-state fields are `.nullish()` (server INSIGHTS: a newly-required
   * field on a persisted-document contract breaks reading old rows).
   */
  async getTour(repoId: string): Promise<Onboarding | undefined> {
    const [row] = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    if (!row) return undefined;
    return withGeneratedAt(row.json, row.generatedAt);
  }

  /**
   * Upsert the tour by `repoId`, stamping a fresh `generatedAt` (last-write-wins),
   * and return the persisted tour with that column folded into `generated_at` so
   * the recompute response carries the real timestamp (AC-19).
   */
  async upsertTour(repoId: string, tour: Onboarding): Promise<Onboarding> {
    const [row] = await this.db
      .insert(t.onboarding)
      .values({ repoId, json: tour })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: tour, generatedAt: sql`now()` },
      })
      .returning({ generatedAt: t.onboarding.generatedAt });
    // An upsert always affects exactly one row, so `.returning()` yields one.
    return withGeneratedAt(tour, row!.generatedAt);
  }
}
