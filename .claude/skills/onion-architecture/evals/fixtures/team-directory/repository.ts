import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type TeamMemberRow = typeof t.teamMembers.$inferSelect;

export class TeamDirectoryRepository {
  constructor(private db: Db) {}

  async list(): Promise<TeamMemberRow[]> {
    return this.db.select().from(t.teamMembers);
  }

  async upsertMember(
    workspaceId: string,
    member: { externalId: string; login: string; displayName: string; isActive: boolean },
  ): Promise<TeamMemberRow> {
    const [existing] = await this.db
      .select()
      .from(t.teamMembers)
      .where(eq(t.teamMembers.externalId, member.externalId));

    if (existing) {
      const [row] = await this.db
        .update(t.teamMembers)
        .set({ displayName: member.displayName, isActive: member.isActive })
        .where(eq(t.teamMembers.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db.insert(t.teamMembers).values({ workspaceId, ...member }).returning();
    return row;
  }
}
