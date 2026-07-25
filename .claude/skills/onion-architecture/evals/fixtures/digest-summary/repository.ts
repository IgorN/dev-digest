import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { DIGEST_NOTIFICATION_JOB_KIND } from './constants.js';

export type DigestSummaryRow = typeof t.digestSummaries.$inferSelect;

export class DigestSummaryRepository {
  constructor(private db: Db, private container: Container) {}

  async findForDay(workspaceId: string, day: string): Promise<DigestSummaryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digestSummaries)
      .where(and(eq(t.digestSummaries.workspaceId, workspaceId), eq(t.digestSummaries.day, day)));
    return row;
  }

  async saveSummary(workspaceId: string, day: string, highlights: unknown): Promise<DigestSummaryRow> {
    const existing = await this.findForDay(workspaceId, day);
    if (existing) {
      const [updated] = await this.db
        .update(t.digestSummaries)
        .set({ highlights })
        .where(eq(t.digestSummaries.id, existing.id))
        .returning();
      return updated;
    }
    const [row] = await this.db.insert(t.digestSummaries).values({ workspaceId, day, highlights }).returning();
    await this.container.jobs.enqueue(workspaceId, DIGEST_NOTIFICATION_JOB_KIND, { day });
    return row;
  }
}
