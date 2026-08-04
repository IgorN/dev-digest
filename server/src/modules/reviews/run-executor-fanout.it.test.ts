/**
 * Bounded-concurrency fan-out — end-to-end proofs against a real Postgres.
 *
 * The behavioural ACs this suite pins:
 *   - AC-5  the SHARED pre-work (the PR diff) is loaded EXACTLY ONCE for an
 *           N-agent fan-out, never once per agent — asserted with an
 *           instrumented git adapter that counts `diff()` invocations; and the
 *           fail-all-on-diff-failure behaviour still holds (a pre-work failure
 *           marks EVERY queued run failed with that reason).
 *   - AC-4  one agent throwing yields one `failed` run and two `completed`
 *           ones, each with its own persisted trace — per-agent failure
 *           isolation survives the sequential → concurrent change.
 *
 * The pure concurrency semantics (max in-flight, wave timing, non-abort on
 * rejection, the named cap's value) live in the DB-free unit suite
 * `concurrency.test.ts`; this file only proves them through the real executor.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { ReviewRepository } from './repository.js';
import type {
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[run-executor fan-out] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff whose one added line is `src/config.ts:11` — the grounding anchor. */
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

/** Model name that makes the scripted provider blow up for exactly one lane. */
const BOOM_MODEL = 'boom-model';

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
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** MockGitClient that COUNTS `diff()` calls — the AC-5 instrument. */
class CountingGitClient extends MockGitClient {
  diffCalls = 0;
  constructor(private readonly failDiff = false) {
    super({ diff: DIFF });
  }
  override async diff() {
    this.diffCalls += 1;
    if (this.failDiff) throw new Error('git diff exploded');
    return super.diff();
  }
}

/** Returns the fixture review, except for `BOOM_MODEL` which throws (AC-4). */
class LaneScriptedLlm implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(): Promise<never> {
    throw new Error('reviews must use completeStructured, never complete()');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.model === BOOM_MODEL) throw new Error('this agent exploded');
    return {
      data: REVIEW_FIXTURE as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: JSON.stringify(REVIEW_FIXTURE),
      attempts: 1,
    };
  }
  async embed(): Promise<never> {
    throw new Error('reviews must not call embed');
  }
}

d('review run executor — bounded fan-out (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepoAndPr() {
    const db = pg.handle.db;
    const name = `fanout-${seq++}-${Date.now()}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Fan-out fixture PR',
        author: 'igorn',
        branch: 'feat/fanout',
        base: 'main',
        headSha: 'fanoutsha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    return { repo: repo!, pr: pr! };
  }

  function appWith(git: CountingGitClient) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git, llm: { openai: new LaneScriptedLlm() } },
    });
  }

  it('loads the shared diff EXACTLY once for a 3-agent fan-out (AC-5)', async () => {
    const git = new CountingGitClient();
    const app = await appWith(git);
    const { pr } = await makeRepoAndPr();

    const agents = await Promise.all(
      ['a', 'b', 'c'].map((suffix) =>
        app.container.agentsRepo.insert({
          workspaceId,
          name: `fanout-diff-${suffix}-${seq++}`,
          provider: 'openai',
          model: 'gpt-4.1',
          systemPrompt: 'review it',
        }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: agents.map((a) => a.id) },
    });
    expect(res.statusCode).toBe(200);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    // One load for THREE agents — the pre-work sits before the fan-out and must
    // stay there; a per-agent load would report 3.
    expect(git.diffCalls).toBe(1);
    await app.close();
  });

  it('isolates a failing agent: 1 failed + 2 done, each with its own trace (AC-4)', async () => {
    const git = new CountingGitClient();
    const app = await appWith(git);
    const { pr } = await makeRepoAndPr();

    const ok1 = await app.container.agentsRepo.insert({
      workspaceId,
      name: `fanout-ok1-${seq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'review it',
    });
    const boom = await app.container.agentsRepo.insert({
      workspaceId,
      name: `fanout-boom-${seq++}`,
      provider: 'openai',
      model: BOOM_MODEL,
      systemPrompt: 'review it',
    });
    const ok2 = await app.container.agentsRepo.insert({
      workspaceId,
      name: `fanout-ok2-${seq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'review it',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ok1.id, boom.id, ok2.id] },
    });
    expect(res.statusCode).toBe(200);

    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    expect(runs).toHaveLength(3);

    const byAgent = new Map(runs.map((r) => [r.agentId, r]));
    expect(byAgent.get(ok1.id)!.status).toBe('done');
    expect(byAgent.get(ok2.id)!.status).toBe('done');
    expect(byAgent.get(boom.id)!.status).toBe('failed');
    expect(byAgent.get(boom.id)!.error).toContain('exploded');

    // Every lane — including the failed one — persisted its OWN trace.
    for (const run of runs) {
      const traces = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, run.id));
      expect(traces, `run ${run.id} has a trace`).toHaveLength(1);
    }
    await app.close();
  });

  it('fails EVERY queued run when the shared pre-work fails (AC-5)', async () => {
    // `loadDiff` falls back to reconstructing the diff from pr_files when the
    // git adapter throws, so the pre-work only truly fails when BOTH sources do.
    const spy = vi
      .spyOn(ReviewRepository.prototype, 'getPrFiles')
      .mockRejectedValue(new Error('pr_files unavailable'));
    try {
      const git = new CountingGitClient(true);
      const app = await appWith(git);
      const { pr } = await makeRepoAndPr();

      const agents = await Promise.all(
        ['x', 'y', 'z'].map((suffix) =>
          app.container.agentsRepo.insert({
            workspaceId,
            name: `fanout-failall-${suffix}-${seq++}`,
            provider: 'openai',
            model: 'gpt-4.1',
            systemPrompt: 'review it',
          }),
        ),
      );

      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: agents.map((a) => a.id) },
      });

      const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
      expect(runs).toHaveLength(3);
      for (const run of runs) {
        expect(run.status).toBe('failed');
        expect(run.error).toContain('Failed to load PR diff');
      }
      await app.close();
    } finally {
      spy.mockRestore();
    }
  });
});
