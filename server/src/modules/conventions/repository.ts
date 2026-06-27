import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, RepoRow } from '../../db/rows.js';
import type { VerifiedCandidate } from './verify.js';

export type { ConventionRow };

/**
 * Conventions data-access. Owns the `conventions` table (the extractor's
 * candidate rows) and the repo-scoped reads/writes the extractor needs.
 * Workspace-scoped throughout — every query carries `workspaceId`.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  /** The target repo, scoped to the workspace (undefined = not this tenant's). */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Stamp the repo's last-scan time + sample count (workspace-scoped). */
  async markScanned(
    workspaceId: string,
    repoId: string,
    scannedAt: Date,
    sampleCount: number,
  ): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ conventionsScannedAt: scannedAt, conventionsSampleCount: sampleCount })
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
  }

  /** Candidates for a repo, highest confidence first. */
  async listForRepo(repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId))
      .orderBy(desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** Accepted (accepted=true) candidates for a repo, highest confidence first. */
  async acceptedForRepo(repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.accepted, true)))
      .orderBy(desc(t.conventions.confidence));
  }

  /**
   * Replace a repo's candidate set with a freshly-verified scan. A re-scan starts
   * the accept/reject decisions over (accepted = null), which matches the UI.
   */
  async replaceForRepo(
    workspaceId: string,
    repoId: string,
    candidates: VerifiedCandidate[],
  ): Promise<void> {
    // Atomic: a crash between the delete and insert must not leave the repo with
    // an empty candidate set. Both halves are workspace-scoped.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      if (candidates.length === 0) return;
      await tx.insert(t.conventions).values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          category: c.category ?? null,
          rule: c.rule,
          evidencePath: c.evidence_path,
          evidenceSnippet: c.evidence_snippet,
          evidenceStartLine: c.evidence_start_line,
          evidenceEndLine: c.evidence_end_line,
          confidence: c.confidence,
          accepted: null,
        })),
      );
    });
  }

  /** Patch a single candidate (accept/reject via `accepted`, or edit rule/category). */
  async update(
    workspaceId: string,
    id: string,
    patch: { accepted?: boolean | null; rule?: string; category?: string | null },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Bulk accept/reject every candidate of a repo (workspace-scoped). */
  async setAcceptedForRepo(workspaceId: string, repoId: string, accepted: boolean): Promise<void> {
    await this.db
      .update(t.conventions)
      .set({ accepted })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }
}
