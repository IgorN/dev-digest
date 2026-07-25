import type { Db } from '../../db/client.js';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { MAX_HIGHLIGHTS } from './constants.js';

export interface DigestHighlight {
  pullRequestId: string;
  title: string;
  authorName: string;
}

/** Trim a digest's findings down to the top N highlights for the summary email. */
export function pickTopHighlights(
  findings: { pullRequestId: string; title: string; severity: number }[],
): { pullRequestId: string; title: string }[] {
  return [...findings]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, MAX_HIGHLIGHTS)
    .map(({ pullRequestId, title }) => ({ pullRequestId, title }));
}

/** Attach the author's display name to each highlight for the email template. */
export async function enrichWithAuthor(
  db: Db,
  highlights: { pullRequestId: string; title: string }[],
): Promise<DigestHighlight[]> {
  const enriched: DigestHighlight[] = [];
  for (const h of highlights) {
    const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, h.pullRequestId));
    enriched.push({ ...h, authorName: pr?.authorName ?? 'unknown' });
  }
  return enriched;
}
