/**
 * GET /pulls/:id/smart-diff — end to end (needs a real DB to seed reviews/
 * findings, so it's Docker-gated, mirroring pulls-findings-rollup.it.test.ts):
 *   - the response parses as SmartDiff,
 *   - a seeded lock file lands in the `boilerplate` group,
 *   - finding_lines reflects the LATEST review per agent only (a re-run
 *     supersedes the older review's findings), with dismissed findings
 *     excluded, and a finding on a file outside the PR's current file list
 *     is dropped rather than erroring,
 *   - a PR id from a different workspace 404s (workspace-scoped lookup),
 *   - the route succeeds even when every LLM provider would throw on any
 *     completion call — the concrete, automatable proof behind "zero new
 *     model calls" for this feature.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { SmartDiff, type LLMProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AGENT_SEC = '11111111-1111-1111-1111-111111111111';

const finding = (
  reviewId: string,
  file: string,
  startLine: number,
  opts: { dismissed?: boolean } = {},
) => ({
  reviewId,
  file,
  startLine,
  endLine: startLine,
  severity: 'WARNING',
  category: 'correctness',
  title: `finding @ ${file}:${startLine}`,
  rationale: 'because reasons',
  confidence: 0.8,
  dismissedAt: opts.dismissed ? new Date('2026-06-01T13:00:00Z') : null,
});

/** An LLMProvider double whose every method throws — injected via
 *  ContainerOverrides.llm so the test doesn't depend on the host machine's
 *  ambient secrets file (deterministic regardless of what's configured
 *  locally). If smart-diff's route/service ever called container.llm(id)
 *  and then invoked a completion method, the request would fail; asserting
 *  200 with this double wired in is the concrete proof of "no new model call". */
function throwingLlmProvider(id: 'openai' | 'anthropic' | 'openrouter'): LLMProvider {
  const boom = (): never => {
    throw new Error(`smart-diff must never call the ${id} LLM provider`);
  };
  return {
    id,
    listModels: async () => boom(),
    complete: async () => boom(),
    completeStructured: async () => boom(),
    embed: async () => boom(),
  };
}

const NO_LLM = {
  llm: {
    openai: throwingLlmProvider('openai'),
    anthropic: throwingLlmProvider('anthropic'),
    openrouter: throwingLlmProvider('openrouter'),
  },
};

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  it('classifies files by role, resolves latest-per-agent survivor findings, drops dismissed/superseded/off-PR findings, and parses as SmartDiff', async () => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `sd-${Date.now()}`, fullName: 'acme/sd' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 11,
        title: 'Charge flow',
        author: 'igorn',
        branch: 'feat/charge',
        base: 'main',
        headSha: 'sha1',
        additions: 10,
        deletions: 2,
        filesCount: 3,
        status: 'open',
      })
      .returning();

    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 400, deletions: 5 },
      { prId: pr!.id, path: 'tsconfig.json', additions: 1, deletions: 0 },
      { prId: pr!.id, path: 'src/services/payment.ts', additions: 8, deletions: 2 },
    ]);

    // Security ran twice (re-run after a fix). Newest-first by createdAt:
    // secNew (11:00) supersedes secOld (10:00) — secOld's findings must vanish.
    const [secOld] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: AGENT_SEC,
        runId: '22222222-2222-2222-2222-222222222221',
        kind: 'review',
        score: 40,
        createdAt: new Date('2026-06-01T10:00:00Z'),
      })
      .returning();
    const [secNew] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: AGENT_SEC,
        runId: '22222222-2222-2222-2222-222222222222',
        kind: 'review',
        score: 60,
        createdAt: new Date('2026-06-01T11:00:00Z'),
      })
      .returning();

    await db.insert(t.findings).values([
      finding(secOld!.id, 'src/services/payment.ts', 5), // superseded — must NOT appear
      finding(secNew!.id, 'src/services/payment.ts', 12), // the one survivor
      finding(secNew!.id, 'src/services/payment.ts', 40, { dismissed: true }), // dismissed — must NOT appear
      finding(secNew!.id, 'src/removed-file.ts', 3), // outside the PR's current file list — must NOT appear/throw
    ]);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);

    const body = SmartDiff.parse(res.json());

    const boilerplate = body.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplate?.files.map((f) => f.path)).toContain('pnpm-lock.yaml');

    const wiring = body.groups.find((g) => g.role === 'wiring');
    expect(wiring?.files.map((f) => f.path)).toContain('tsconfig.json');

    const core = body.groups.find((g) => g.role === 'core');
    const payment = core?.files.find((f) => f.path === 'src/services/payment.ts');
    expect(payment?.finding_lines).toEqual([12]);

    // The off-PR-file finding, the dismissed finding, and the superseded
    // finding must not leak into ANY file in ANY group — only the one
    // surviving line exists anywhere in the whole response.
    const allLines = body.groups.flatMap((g) => g.files.flatMap((f) => f.finding_lines));
    expect(allLines).toEqual([12]);

    await app.close();
  });

  it('a PR from a different workspace 404s (workspace-scoped lookup)', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'acme', name: `foreign-${Date.now()}`, fullName: 'acme/foreign' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: repo!.id,
        number: 1,
        title: 'Foreign PR',
        author: 'ghost',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 0,
        status: 'open',
      })
      .returning();

    // getContext always resolves the DEFAULT workspace (LocalNoAuthProvider,
    // MVP no-login mode) — so a PR that lives in `otherWs` is unreachable
    // through the route regardless of which id is requested.
    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('succeeds (200) even when every LLM provider throws on any call — proves zero new model calls', async () => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `noai-${Date.now()}`, fullName: 'acme/noai' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 2,
        title: 'No AI provider available',
        author: 'igorn',
        branch: 'feat/noai',
        base: 'main',
        headSha: 'sha2',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values([{ prId: pr!.id, path: 'src/util.ts', additions: 1, deletions: 0 }]);

    const app = await buildApp({ config: config(), db, overrides: NO_LLM });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    SmartDiff.parse(res.json());

    await app.close();
  });
});
