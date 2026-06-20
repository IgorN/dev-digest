/**
 * GET /repos/:id/pulls FINDINGS rollup — the on-read aggregation behind the
 * PR-list FINDINGS column. Verifies the non-trivial rules end to end (needs a
 * real DB to seed reviews/findings, so it's Docker-gated):
 *   - union of the LATEST review PER AGENT (every agent represented),
 *   - a re-run of an agent SUPERSEDES its older review (no stale/dupe findings),
 *   - DISMISSED findings are excluded,
 *   - SCORE stays the single newest review's score.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AGENT_SEC = '11111111-1111-1111-1111-111111111111';
const AGENT_PERF = '22222222-2222-2222-2222-222222222222';

const finding = (reviewId: string, severity: string, title: string, dismissed = false) => ({
  reviewId,
  file: 'src/x.ts',
  startLine: 1,
  endLine: 1,
  severity,
  category: 'security',
  title,
  rationale: 'because reasons',
  confidence: 0.9,
  dismissedAt: dismissed ? new Date('2026-06-01T13:00:00Z') : null,
});

d('GET /repos/:id/pulls — FINDINGS rollup (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('unions latest-per-agent, drops superseded + dismissed, keeps newest score', async () => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `rollup-${Date.now()}`, fullName: 'acme/rollup' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add notes',
        author: 'igorn',
        branch: 'feat/notes',
        base: 'main',
        headSha: 'abc',
        additions: 5,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();

    // Security ran twice (re-run after a fix); Performance ran once. Newest-first
    // by createdAt: Perf (12:00) > Security#2 (11:00) > Security#1 (10:00).
    const [secOld] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: AGENT_SEC, runId: '33333333-3333-3333-3333-333333333331', kind: 'review', score: 30, createdAt: new Date('2026-06-01T10:00:00Z') })
      .returning();
    const [secNew] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: AGENT_SEC, runId: '33333333-3333-3333-3333-333333333332', kind: 'review', score: 50, createdAt: new Date('2026-06-01T11:00:00Z') })
      .returning();
    const [perf] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: AGENT_PERF, runId: '44444444-4444-4444-4444-444444444441', kind: 'review', score: 70, createdAt: new Date('2026-06-01T12:00:00Z') })
      .returning();

    await db.insert(t.findings).values([
      finding(secOld!.id, 'CRITICAL', 'OLD crit'), // superseded by secNew
      finding(secOld!.id, 'WARNING', 'OLD warn'), // superseded
      finding(secNew!.id, 'CRITICAL', 'NEW crit'), // counts
      finding(secNew!.id, 'CRITICAL', 'DISMISSED crit', true), // excluded (dismissed)
      finding(perf!.id, 'WARNING', 'Perf warn'), // counts
    ]);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    expect(res.statusCode).toBe(200);
    const meta = (res.json() as PrMeta[]).find((p) => p.id === pr!.id)!;

    // Union = Security#2 (1 critical, dismissed excluded) + Perf (1 warning).
    expect(meta.findings_critical).toBe(1);
    expect(meta.findings_warning).toBe(1);
    expect(meta.findings_suggestion).toBe(0);
    // SCORE = newest review overall (Performance, 70).
    expect(meta.score).toBe(70);

    const titles = (meta.findings ?? []).map((f) => f.title);
    expect(titles).toEqual(expect.arrayContaining(['NEW crit', 'Perf warn']));
    expect(titles).not.toContain('OLD crit'); // superseded
    expect(titles).not.toContain('OLD warn'); // superseded
    expect(titles).not.toContain('DISMISSED crit'); // dismissed

    await app.close();
  });
});
