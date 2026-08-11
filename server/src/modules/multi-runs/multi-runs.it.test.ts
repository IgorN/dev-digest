/**
 * Multi-Agent Review — end-to-end AC proofs (Docker-gated: real container +
 * real Postgres via Testcontainers, mirroring `eval/eval.it.test.ts`).
 *
 * The behavioural ACs this suite pins:
 *   - AC-60  a four-agent launch creates EXACTLY one `multi_agent_runs` row with
 *            exactly four `agent_runs` rows referencing it; the legacy
 *            `{agentId}` and `{all:true}` launches create NO multi-run row and
 *            return no `multi_run_id`.
 *   - AC-62  an `agentIds` carrying an id from a second workspace, and one
 *            naming a DISABLED agent, each return 4xx with ZERO runs created.
 *   - AC-63  the same id posted three times creates ONE run.
 *   - AC-64  a multi-run seeded under a second workspace 404s, as does an
 *            unresolvable id.
 *   - AC-61  a query joining findings → review → run → agent returns the
 *            producing agent for every finding in a multi-run.
 *   - AC-26  the two estimate averages have DIFFERENT denominators when an
 *            agent's runs are partly unpriced; failed runs and other
 *            workspaces' runs are excluded.
 *   - AC-27  a history-less agent reports both metrics absent (null), never 0.
 *   - AC-22b `GET /multi-runs/latest?repoId=` returns the newest multi-run OF
 *            THE REQUESTED REPOSITORY; a scope with none answers 2xx with
 *            `multi_run: null`, NOT 404; a cross-workspace repoId resolves to
 *            the empty result rather than leaking; both/neither scope is a
 *            typed 400.
 *   - AC-21b `GET /multi-runs/latest?prId=` returns the newest by the
 *            MULTI-RUN's own timestamp.
 *   - R12    the three read routes make ZERO model calls (proved with an
 *            always-throwing `ContainerOverrides.llm` double).
 *
 * Concurrency/fan-out behaviour (AC-1 – AC-5) lives in
 * `reviews/run-executor-fanout.it.test.ts`; the pure grouping rules
 * (AC-6 – AC-15) live in the DB-free `grouping.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import {
  AgentRunEstimate,
  LatestMultiRunResponse,
  MultiRunDocument,
  type LLMProvider,
  type Review,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-runs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: null,
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/**
 * A `completeStructured`-only fixture provider, available for EVERY provider id.
 *
 * All three ids must be overridden, not just `openai`: the seeded agents use
 * `openrouter` (`db/seed.ts`'s `DEFAULT_PROVIDER`), so a `{all:true}` launch
 * would otherwise fall through to the real `LocalSecretsProvider` lookup and —
 * on any machine that happens to hold an OpenRouter key — issue LIVE network
 * calls, making the suite slow and environment-dependent.
 */
class FixtureLlm implements LLMProvider {
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  async listModels() {
    return [{ id: 'gpt-4.1', provider: this.id }];
  }
  async complete(): Promise<never> {
    throw new Error('reviews must use completeStructured, never complete()');
  }
  async completeStructured<T>(req: { model: string }): Promise<{
    data: T;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    raw: string;
    attempts: number;
  }> {
    return {
      data: REVIEW_FIXTURE as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(REVIEW_FIXTURE),
      attempts: 1,
    };
  }
  async embed(): Promise<never> {
    throw new Error('reviews must not call embed');
  }
}

const FIXTURE_LLM = {
  openai: new FixtureLlm('openai'),
  anthropic: new FixtureLlm('anthropic'),
  openrouter: new FixtureLlm('openrouter'),
};

/** Every method throws — the concrete proof behind "this route makes no LLM call". */
function throwingLlm(id: 'openai' | 'anthropic' | 'openrouter'): LLMProvider {
  const boom = (): never => {
    throw new Error(`multi-runs must not call the ${id} LLM provider here`);
  };
  return {
    id,
    listModels: async () => boom(),
    complete: async () => boom(),
    completeStructured: async () => boom(),
    embed: async () => boom(),
  };
}

const THROWING_LLM = {
  openai: throwingLlm('openai'),
  anthropic: throwingLlm('anthropic'),
  openrouter: throwingLlm('openrouter'),
};

d('multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let seq = 0;

  const uniq = (label: string) => `${label}-${seq++}-${Date.now()}`;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'second-workspace' })
      .returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  async function makeRepo(ws = workspaceId) {
    const name = uniq('repo');
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!;
  }

  async function makePr(repoId: string, number: number, ws = workspaceId) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId,
        number,
        title: `Multi-run fixture PR #${number}`,
        author: 'igorn',
        branch: 'feat/multi',
        base: 'main',
        headSha: `sha-${number}-${seq++}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'stale',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    return pr!;
  }

  async function makeRepoAndPr(ws = workspaceId) {
    const repo = await makeRepo(ws);
    const pr = await makePr(repo.id, 1, ws);
    return { repo, pr };
  }

  async function makeAgent(opts: { ws?: string; enabled?: boolean; name?: string } = {}) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        name: opts.name ?? uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
        enabled: opts.enabled ?? true,
      })
      .returning();
    return agent!;
  }

  async function insertMultiRun(prId: string, ranAt: Date, ws = workspaceId) {
    const [row] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: ws, prId, ranAt })
      .returning();
    return row!;
  }

  /** Seed a completed lane: agent_run → review → findings. */
  async function seedLane(opts: {
    prId: string;
    agentId: string | null;
    multiRunId: string;
    ranAt: Date;
    status?: string;
    durationMs?: number | null;
    costUsd?: number | null;
    score?: number | null;
    summary?: string | null;
    findings?: {
      file: string;
      startLine: number;
      endLine: number;
      severity: string;
      title: string;
    }[];
  }) {
    const db = pg.handle.db;
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: opts.agentId,
        prId: opts.prId,
        multiRunId: opts.multiRunId,
        ranAt: opts.ranAt,
        provider: 'openai',
        model: 'gpt-4.1',
        status: opts.status ?? 'done',
        // `?? ` would swallow an EXPLICIT null (a failed lane has no duration
        // or cost), so distinguish "omitted" from "explicitly null" here.
        durationMs: opts.durationMs === undefined ? 1000 : opts.durationMs,
        costUsd: opts.costUsd === undefined ? 0.01 : opts.costUsd,
        score: opts.score === undefined ? 70 : opts.score,
      })
      .returning();
    if ((opts.status ?? 'done') !== 'done') return { run: run!, findings: [] };

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: opts.prId,
        agentId: opts.agentId,
        runId: run!.id,
        kind: 'review' as const,
        verdict: 'comment',
        summary: opts.summary ?? 'seeded summary',
        score: opts.score ?? 70,
        model: 'gpt-4.1',
      })
      .returning();
    const findings = opts.findings ?? [];
    if (findings.length === 0) return { run: run!, review: review!, findings: [] };
    const rows = await db
      .insert(t.findings)
      .values(
        findings.map((f) => ({
          reviewId: review!.id,
          file: f.file,
          startLine: f.startLine,
          endLine: f.endLine,
          severity: f.severity,
          category: 'bug',
          title: f.title,
          rationale: 'seeded rationale',
          confidence: 0.9,
        })),
      )
      .returning();
    return { run: run!, review: review!, findings: rows };
  }

  function workingApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: DIFF }), llm: FIXTURE_LLM },
    });
  }

  function readOnlyApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: DIFF }), llm: THROWING_LLM },
    });
  }

  const runsFor = (prId: string) =>
    pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));

  // =========================================================================
  // Launch — AC-60 / AC-62 / AC-63
  // =========================================================================

  describe('POST /pulls/:id/review with agentIds', () => {
    it('a four-agent launch creates ONE multi-run with exactly four linked runs (AC-60)', async () => {
      const app = await workingApp();
      const { pr } = await makeRepoAndPr();
      const agents = await Promise.all([makeAgent(), makeAgent(), makeAgent(), makeAgent()]);

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: agents.map((a) => a.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.multi_run_id).toEqual(expect.any(String));
      expect(body.runs).toHaveLength(4);

      const multiRuns = await pg.handle.db
        .select()
        .from(t.multiAgentRuns)
        .where(eq(t.multiAgentRuns.prId, pr.id));
      expect(multiRuns).toHaveLength(1);
      expect(multiRuns[0]!.id).toBe(body.multi_run_id);

      const linked = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.multiRunId, body.multi_run_id));
      expect(linked).toHaveLength(4);
      expect(new Set(linked.map((r) => r.agentId))).toEqual(new Set(agents.map((a) => a.id)));

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 4 });
      await app.close();
    });

    it('rejects an agent id from a SECOND workspace, creating zero runs (AC-62)', async () => {
      const app = await workingApp();
      const { pr } = await makeRepoAndPr();
      const mine = await makeAgent();
      const foreign = await makeAgent({ ws: otherWorkspaceId });

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: [mine.id, foreign.id] },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await runsFor(pr.id)).toHaveLength(0);
      expect(
        await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id)),
      ).toHaveLength(0);
      await app.close();
    });

    it('rejects a DISABLED agent id, creating zero runs (AC-62)', async () => {
      const app = await workingApp();
      const { pr } = await makeRepoAndPr();
      const enabled = await makeAgent();
      const disabled = await makeAgent({ enabled: false });

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: [enabled.id, disabled.id] },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await runsFor(pr.id)).toHaveLength(0);
      await app.close();
    });

    it('treats the same agent id posted three times as ONE target (AC-63)', async () => {
      const app = await workingApp();
      const { pr } = await makeRepoAndPr();
      const agent = await makeAgent();

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: [agent.id, agent.id, agent.id] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().runs).toHaveLength(1);
      expect(await runsFor(pr.id)).toHaveLength(1);

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      await app.close();
    });

    it('the LEGACY {agentId} and {all:true} paths create NO multi-run (AC-60, edge case)', async () => {
      const app = await workingApp();
      const agent = await makeAgent();

      const single = await makeRepoAndPr();
      const singleRes = await app.inject({
        method: 'POST',
        url: `/pulls/${single.pr.id}/review`,
        payload: { agentId: agent.id },
      });
      expect(singleRes.statusCode).toBe(200);
      expect(singleRes.json().multi_run_id).toBeUndefined();
      expect(
        await pg.handle.db
          .select()
          .from(t.multiAgentRuns)
          .where(eq(t.multiAgentRuns.prId, single.pr.id)),
      ).toHaveLength(0);
      const singleRuns = await runsFor(single.pr.id);
      expect(singleRuns.every((r) => r.multiRunId === null)).toBe(true);

      const all = await makeRepoAndPr();
      const enabledCount = (await app.container.agentsRepo.listEnabled(workspaceId)).length;
      const allRes = await app.inject({
        method: 'POST',
        url: `/pulls/${all.pr.id}/review`,
        payload: { all: true },
      });
      expect(allRes.statusCode).toBe(200);
      expect(allRes.json().multi_run_id).toBeUndefined();
      expect(
        await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, all.pr.id)),
      ).toHaveLength(0);

      await waitForPrRuns(pg.handle.db, single.pr.id, { expected: 1 });
      await waitForPrRuns(pg.handle.db, all.pr.id, { expected: enabledCount, timeoutMs: 20_000 });
      await app.close();
    });
  });

  // =========================================================================
  // Result document — AC-64 / AC-61
  // =========================================================================

  describe('GET /multi-runs/:id', () => {
    it('returns a complete document with lanes in agent order and computed groups', async () => {
      const app = await readOnlyApp();
      const { pr } = await makeRepoAndPr();
      const [a1, a2, a3] = await Promise.all([makeAgent(), makeAgent(), makeAgent()]);
      const multiRun = await insertMultiRun(pr.id, new Date('2026-08-01T10:00:00Z'));

      await seedLane({
        prId: pr.id,
        agentId: a1!.id,
        multiRunId: multiRun.id,
        ranAt: new Date('2026-08-01T10:00:01Z'),
        durationMs: 4000,
        costUsd: 0.05,
        findings: [
          { file: 'src/config.ts', startLine: 10, endLine: 20, severity: 'WARNING', title: 'Magic number 3600' },
        ],
      });
      await seedLane({
        prId: pr.id,
        agentId: a2!.id,
        multiRunId: multiRun.id,
        ranAt: new Date('2026-08-01T10:00:02Z'),
        durationMs: 9000,
        costUsd: 0.07,
        findings: [
          { file: 'src/config.ts', startLine: 18, endLine: 30, severity: 'SUGGESTION', title: 'Extract a constant' },
        ],
      });
      // A failed lane contributes `no_result`, never `did not flag`.
      await seedLane({
        prId: pr.id,
        agentId: a3!.id,
        multiRunId: multiRun.id,
        ranAt: new Date('2026-08-01T10:00:03Z'),
        status: 'failed',
        durationMs: null,
        costUsd: null,
      });

      const res = await app.inject({ method: 'GET', url: `/multi-runs/${multiRun.id}` });
      expect(res.statusCode).toBe(200);
      const doc = MultiRunDocument.parse(res.json());

      expect(doc.id).toBe(multiRun.id);
      expect(doc.pr).toMatchObject({ id: pr.id, number: pr.number, title: pr.title });
      // Ordered by the run's ran_at ASC — the authoritative agent order.
      expect(doc.agents.map((a) => a.agent_id)).toEqual([a1!.id, a2!.id, a3!.id]);
      expect(doc.agents[2]!.status).toBe('failed');
      // MAX duration across completed lanes, SUM of costs, agent count.
      expect(doc.totals).toEqual({
        max_duration_ms: 9000,
        total_cost_usd: expect.closeTo(0.12, 5),
        agent_count: 3,
      });

      // The two overlapping findings collapse into ONE group with three cells.
      expect(doc.groups).toHaveLength(1);
      const group = doc.groups[0]!;
      expect(group).toMatchObject({ file: 'src/config.ts', line: 10, conflict: true });
      expect(group.cells.map((c) => c.verdict)).toEqual(['flagged', 'flagged', 'no_result']);
      expect(group.cells.map((c) => c.agent_id)).toEqual([a1!.id, a2!.id, a3!.id]);
      await app.close();
    });

    it('answers "which agent found this" for every finding from stored data alone (AC-61)', async () => {
      const db = pg.handle.db;
      const app = await readOnlyApp();
      const { pr } = await makeRepoAndPr();
      const [a1, a2] = await Promise.all([makeAgent(), makeAgent()]);
      const multiRun = await insertMultiRun(pr.id, new Date('2026-08-01T11:00:00Z'));

      await seedLane({
        prId: pr.id,
        agentId: a1!.id,
        multiRunId: multiRun.id,
        ranAt: new Date('2026-08-01T11:00:01Z'),
        findings: [
          { file: 'src/a.ts', startLine: 1, endLine: 2, severity: 'WARNING', title: 'A one' },
          { file: 'src/a.ts', startLine: 50, endLine: 51, severity: 'CRITICAL', title: 'A two' },
        ],
      });
      await seedLane({
        prId: pr.id,
        agentId: a2!.id,
        multiRunId: multiRun.id,
        ranAt: new Date('2026-08-01T11:00:02Z'),
        findings: [{ file: 'src/b.ts', startLine: 7, endLine: 9, severity: 'SUGGESTION', title: 'B one' }],
      });

      // findings → reviews → agent_runs → agents, scoped to this multi-run.
      const rows = await db
        .select({
          findingTitle: t.findings.title,
          agentId: t.agents.id,
          agentName: t.agents.name,
          runId: t.agentRuns.id,
        })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
        .innerJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
        .where(eq(t.agentRuns.multiRunId, multiRun.id));

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.agentId && r.agentName && r.runId)).toBe(true);
      const byTitle = new Map(rows.map((r) => [r.findingTitle, r.agentId]));
      expect(byTitle.get('A one')).toBe(a1!.id);
      expect(byTitle.get('A two')).toBe(a1!.id);
      expect(byTitle.get('B one')).toBe(a2!.id);

      // The served document carries the same attribution per lane.
      const doc = MultiRunDocument.parse(
        (await app.inject({ method: 'GET', url: `/multi-runs/${multiRun.id}` })).json(),
      );
      expect(doc.agents.find((a) => a.agent_id === a1!.id)!.findings).toHaveLength(2);
      expect(doc.agents.find((a) => a.agent_id === a2!.id)!.findings).toHaveLength(1);
      await app.close();
    });

    it('404s a multi-run seeded under a SECOND workspace, and an unknown id (AC-64)', async () => {
      const app = await readOnlyApp();
      const foreignRepo = await makeRepo(otherWorkspaceId);
      const foreignPr = await makePr(foreignRepo.id, 9, otherWorkspaceId);
      const foreign = await insertMultiRun(foreignPr.id, new Date(), otherWorkspaceId);

      expect((await app.inject({ method: 'GET', url: `/multi-runs/${foreign.id}` })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: `/multi-runs/${randomUUID()}` })).statusCode,
      ).toBe(404);
      await app.close();
    });
  });

  // =========================================================================
  // Estimates — AC-26 / AC-27
  // =========================================================================

  describe('GET /agent-estimates', () => {
    it('averages a mix with DIFFERING denominators, and reports a history-less agent as absent (AC-26, AC-27)', async () => {
      const db = pg.handle.db;
      const app = await readOnlyApp();
      const { pr } = await makeRepoAndPr();

      const priced = await makeAgent({ name: uniq('priced') });
      const unpriced = await makeAgent({ name: uniq('unpriced') });
      const fresh = await makeAgent({ name: uniq('fresh') });

      // `priced`: two done runs, only ONE of which carries a cost → duration
      // averages over 2 samples, cost over 1. Plus a FAILED run and a run in
      // another workspace, neither of which may be counted.
      await db.insert(t.agentRuns).values([
        { workspaceId, agentId: priced.id, prId: pr.id, status: 'done', durationMs: 1000, costUsd: 0.02 },
        { workspaceId, agentId: priced.id, prId: pr.id, status: 'done', durationMs: 3000, costUsd: null },
        { workspaceId, agentId: priced.id, prId: pr.id, status: 'failed', durationMs: 999_999, costUsd: 9.99 },
        {
          workspaceId: otherWorkspaceId,
          agentId: priced.id,
          prId: pr.id,
          status: 'done',
          durationMs: 888_888,
          costUsd: 8.88,
        },
      ]);
      // `unpriced`: history exists but every cost is null (unpriced provider).
      await db.insert(t.agentRuns).values([
        { workspaceId, agentId: unpriced.id, prId: pr.id, status: 'done', durationMs: 500, costUsd: null },
        { workspaceId, agentId: unpriced.id, prId: pr.id, status: 'done', durationMs: 1500, costUsd: null },
      ]);

      // Newest review summary backs the agent card's one-line blurb.
      const [lastRun] = await db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId: priced.id, prId: pr.id, status: 'done', durationMs: 2000, costUsd: 0.02 })
        .returning();
      await db.insert(t.reviews).values({
        workspaceId,
        prId: pr.id,
        agentId: priced.id,
        runId: lastRun!.id,
        kind: 'review' as const,
        summary: 'Latest summary for the priced agent',
      });

      const res = await app.inject({ method: 'GET', url: '/agent-estimates' });
      expect(res.statusCode).toBe(200);
      const estimates = AgentRunEstimate.array().parse(res.json());
      const byId = new Map(estimates.map((e) => [e.agent_id, e]));

      const p = byId.get(priced.id)!;
      // durations 1000 + 3000 + 2000 over 3 samples; costs 0.02 + 0.02 over 2.
      expect(p.duration_sample_count).toBe(3);
      expect(p.avg_duration_ms).toBeCloseTo(2000, 5);
      expect(p.cost_sample_count).toBe(2);
      expect(p.avg_cost_usd).toBeCloseTo(0.02, 5);
      expect(p.last_summary).toBe('Latest summary for the priced agent');

      const u = byId.get(unpriced.id)!;
      expect(u.avg_duration_ms).toBeCloseTo(1000, 5);
      expect(u.duration_sample_count).toBe(2);
      expect(u.avg_cost_usd).toBeNull();
      expect(u.cost_sample_count).toBe(0);

      const f = byId.get(fresh.id)!;
      expect(f.avg_duration_ms).toBeNull();
      expect(f.avg_cost_usd).toBeNull();
      expect(f.duration_sample_count).toBe(0);
      expect(f.cost_sample_count).toBe(0);
      expect(f.last_summary ?? null).toBeNull();
      await app.close();
    });

    it('lists only ENABLED agents of the caller workspace', async () => {
      const app = await readOnlyApp();
      const disabled = await makeAgent({ enabled: false });
      const foreign = await makeAgent({ ws: otherWorkspaceId });

      const estimates = AgentRunEstimate.array().parse(
        (await app.inject({ method: 'GET', url: '/agent-estimates' })).json(),
      );
      const ids = new Set(estimates.map((e) => e.agent_id));
      expect(ids.has(disabled.id)).toBe(false);
      expect(ids.has(foreign.id)).toBe(false);
      await app.close();
    });
  });

  // =========================================================================
  // Latest-multi-run resolution — AC-22b / AC-21b
  // =========================================================================

  describe('GET /multi-runs/latest', () => {
    it('returns the newest multi-run OF THE REQUESTED REPOSITORY (AC-22b)', async () => {
      const app = await readOnlyApp();
      const repoA = await makeRepo();
      const repoB = await makeRepo();
      const prA1 = await makePr(repoA.id, 1);
      const prA2 = await makePr(repoA.id, 2);
      const prB1 = await makePr(repoB.id, 1);

      // Explicit, distinct ran_at values — never rely on defaultNow() ordering.
      await insertMultiRun(prA1.id, new Date('2026-07-01T00:00:00Z'));
      const newestInA = await insertMultiRun(prA2.id, new Date('2026-07-03T00:00:00Z'));
      // Newest overall, but in ANOTHER repository — it must not win for repo A.
      await insertMultiRun(prB1.id, new Date('2026-07-09T00:00:00Z'));

      const res = await app.inject({ method: 'GET', url: `/multi-runs/latest?repoId=${repoA.id}` });
      expect(res.statusCode).toBe(200);
      const body = LatestMultiRunResponse.parse(res.json());
      expect(body.multi_run).toMatchObject({
        id: newestInA.id,
        pr_id: prA2.id,
        pr_number: prA2.number,
        pr_title: prA2.title,
      });
      await app.close();
    });

    it('answers a repository with no multi-run with 2xx + null, NOT 404 (AC-22b)', async () => {
      const app = await readOnlyApp();
      const emptyRepo = await makeRepo();

      const res = await app.inject({ method: 'GET', url: `/multi-runs/latest?repoId=${emptyRepo.id}` });
      expect(res.statusCode).toBe(200);
      expect(LatestMultiRunResponse.parse(res.json()).multi_run).toBeNull();
      await app.close();
    });

    it('returns the newest by the MULTI-RUN\'s own timestamp for a PR scope (AC-21b)', async () => {
      const app = await readOnlyApp();
      const { pr } = await makeRepoAndPr();

      const oldest = await insertMultiRun(pr.id, new Date('2026-06-01T00:00:00Z'));
      const newest = await insertMultiRun(pr.id, new Date('2026-06-20T00:00:00Z'));
      const middle = await insertMultiRun(pr.id, new Date('2026-06-10T00:00:00Z'));

      // The OLDEST multi-run carries the NEWEST agent_run — ordering must follow
      // the multi-run's own ran_at, not any run timestamp.
      const agent = await makeAgent();
      await seedLane({
        prId: pr.id,
        agentId: agent.id,
        multiRunId: oldest.id,
        ranAt: new Date('2026-12-31T00:00:00Z'),
      });

      const body = LatestMultiRunResponse.parse(
        (await app.inject({ method: 'GET', url: `/multi-runs/latest?prId=${pr.id}` })).json(),
      );
      expect(body.multi_run!.id).toBe(newest.id);
      expect(body.multi_run!.id).not.toBe(middle.id);
      expect(body.multi_run!.id).not.toBe(oldest.id);
      await app.close();
    });

    it('never leaks another workspace\'s multi-run for a foreign repoId (AC-22b)', async () => {
      const app = await readOnlyApp();
      const foreignRepo = await makeRepo(otherWorkspaceId);
      const foreignPr = await makePr(foreignRepo.id, 3, otherWorkspaceId);
      await insertMultiRun(foreignPr.id, new Date('2026-07-15T00:00:00Z'), otherWorkspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/latest?repoId=${foreignRepo.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(LatestMultiRunResponse.parse(res.json()).multi_run).toBeNull();
      await app.close();
    });

    it('rejects supplying BOTH or NEITHER scope parameter with a typed 400', async () => {
      const app = await readOnlyApp();
      const repo = await makeRepo();
      const pr = await makePr(repo.id, 4);

      const neither = await app.inject({ method: 'GET', url: '/multi-runs/latest' });
      expect(neither.statusCode).toBe(400);
      expect(neither.json().error.code).toBe('invalid_scope');

      const both = await app.inject({
        method: 'GET',
        url: `/multi-runs/latest?repoId=${repo.id}&prId=${pr.id}`,
      });
      expect(both.statusCode).toBe(400);
      expect(both.json().error.code).toBe('invalid_scope');
      await app.close();
    });
  });

  // =========================================================================
  // R12 — the read routes make zero model calls
  // =========================================================================

  it('serves all three read routes with an always-throwing LLM double (R12)', async () => {
    const app = await readOnlyApp();
    const { pr } = await makeRepoAndPr();
    const agent = await makeAgent();
    const multiRun = await insertMultiRun(pr.id, new Date('2026-08-02T09:00:00Z'));
    await seedLane({
      prId: pr.id,
      agentId: agent.id,
      multiRunId: multiRun.id,
      ranAt: new Date('2026-08-02T09:00:01Z'),
      findings: [
        { file: 'src/config.ts', startLine: 11, endLine: 11, severity: 'CRITICAL', title: 'Secret' },
      ],
    });

    for (const url of [
      `/multi-runs/${multiRun.id}`,
      `/multi-runs/latest?prId=${pr.id}`,
      '/agent-estimates',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} responded ${res.statusCode}`).toBe(200);
    }

    // And the run that produced them is still linked to its multi-run.
    const linked = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.multiRunId, multiRun.id), eq(t.agentRuns.prId, pr.id)));
    expect(linked).toHaveLength(1);
    await app.close();
  });
});
