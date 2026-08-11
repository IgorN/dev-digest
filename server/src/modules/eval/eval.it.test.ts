/**
 * Eval pipeline — end-to-end AC proofs (Docker-gated: real container + real
 * Postgres via Testcontainers, mirroring smart-diff.it.test.ts /
 * onboarding.it.test.ts).
 *
 * The behavioural ACs this suite pins:
 *   - AC-1/AC-2  POST /findings/:id/eval-case on an accepted finding produces
 *                exactly one `must_find` expectation item matching the
 *                finding's file/lines; on a dismissed finding, one
 *                `must_not_flag` item.
 *   - AC-3/AC-4  a still-pending finding, and an agent-less review's finding,
 *                both reject (not silently accepted).
 *   - AC-5       the created case's `input_diff`/`input_files` contain ONLY
 *                the finding's own file's hunk, never the whole PR's diff;
 *                the case is a frozen, independently-refetchable snapshot.
 *   - AC-11/12/13 POST /agents/:id/eval-runs against a real (seeded) case set
 *                executes through the real `reviewer-core` path feeding each
 *                case's STORED inputs (an always-throwing `ContainerOverrides.git`
 *                double proves zero live repo/PR fetch), inserts one
 *                `eval_runs` row per TARGETED case, and the response validates
 *                against `EvalRunBatchResponse`.
 *   - AC-11 edge  an empty-case-set agent → an empty aggregate, not an error;
 *                separately, `case_ids: []` on a non-empty set resolves to
 *                "every case" (this module's own documented default), not zero.
 *   - AC-20/21   a `ContainerOverrides.llm` double that allows exactly ONE
 *                `completeStructured` call (the review-generation call itself)
 *                and throws on anything beyond that budget (any `complete`/
 *                `embed`/`listModels` call, or a second `completeStructured`)
 *                — the run still scores and persists correctly, proving
 *                scoring/persistence make zero further LLM calls.
 *   - AC-22      two consecutive batches (before/after a `system_prompt` edit)
 *                against a provider double that intentionally returns a
 *                DIFFERENT finding set post-edit → the two runs' persisted
 *                aggregates (and the dashboard's current/delta) differ.
 *   - AC-25      a `must_find` case and a `must_not_flag` case each
 *                independently create → run → score correctly.
 *   - AC-39      a case/run seeded under a SECOND workspace is unreachable
 *                (404 or an empty/non-leaking result, per each route's own
 *                shape) from the default-workspace context.
 *
 * Deliberately NOT re-tested here (see the implementer's report for why):
 *   - AC-37 ("Promote v‹N›" → agent's current config matches the promoted
 *     version + a new version row recorded) — this feature's OWN routes never
 *     implement "Promote"; it is a client-side (T16) call to the EXISTING,
 *     unrelated `PUT /agents/:id` endpoint. Re-testing that endpoint's
 *     versioning behavior here would be testing agents-module internals, not
 *     this module's own routes.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { EVAL_CASE_AGENT_NAME } from '../../db/seed-eval-cases.js';
import * as t from '../../db/schema.js';
import {
  EvalCase,
  EvalRunBatchResponse,
  EvalWorkspaceDashboard,
  type GitClient,
  type LLMProvider,
  type Review,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ===========================================================================
// Doubles
// ===========================================================================

type LlmId = 'openai' | 'anthropic' | 'openrouter';

/** Every method throws — the concrete proof behind "this path makes no LLM call". */
function throwingLlm(id: LlmId): LLMProvider {
  const boom = (): never => {
    throw new Error(`eval must not call the ${id} LLM provider here`);
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

/** Every method throws — proves a route never touches a live repo/PR-fetch
 *  adapter (AC-11/AC-12: eval always feeds a case's STORED inputs). */
function throwingGit(): GitClient {
  const boom = (): never => {
    throw new Error(
      'eval must never touch a live git/PR-fetch adapter for an already-created case — only its stored input_diff/input_files',
    );
  };
  return {
    clone: async () => boom(),
    fetchPullHead: async () => boom(),
    sync: async () => boom(),
    currentHead: async () => boom(),
    diff: async () => boom(),
    diffNameOnly: async () => boom(),
    blame: async () => boom(),
    log: async () => boom(),
    readFile: async () => boom(),
    listFiles: async () => boom(),
    clonePathFor: () => {
      throw new Error('eval must never touch a live git adapter');
    },
  };
}

function findingFixture(file: string, line: number): Review['findings'][number] {
  return {
    id: randomUUID(),
    severity: 'WARNING',
    category: 'bug',
    title: 'stubbed finding',
    file,
    start_line: line,
    end_line: line,
    rationale: 'stubbed for the eval pipeline it-test',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
  };
}

function reviewFixture(findings: Review['findings']): Review {
  return {
    verdict: findings.length ? 'comment' : 'approve',
    summary: 'stubbed review',
    score: findings.length ? 60 : 95,
    findings,
  };
}

/**
 * A scripted `completeStructured`-only provider: `reviewFor()` is called on
 * every `completeStructured` invocation (so a test can flip its return value
 * BETWEEN two `runBatch` calls, AC-22), and any call beyond `maxStructuredCalls`
 * — or any call to `complete`/`embed`/`listModels` at all — throws. Asserting
 * a batch still scores/persists correctly with this double wired in is the
 * concrete proof that scoring/persistence make ZERO LLM calls beyond the
 * review-generation call itself (AC-20/AC-21).
 */
class ScriptedLlm implements LLMProvider {
  readonly id: LlmId;
  structuredCalls = 0;
  otherCalls: string[] = [];
  constructor(
    id: LlmId,
    private reviewFor: () => Review,
    private maxStructuredCalls = Infinity,
  ) {
    this.id = id;
  }
  async listModels(): Promise<never> {
    this.otherCalls.push('listModels');
    throw new Error('eval must not call listModels');
  }
  async complete(): Promise<never> {
    this.otherCalls.push('complete');
    throw new Error('eval must use completeStructured, never complete()');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.structuredCalls++;
    if (this.structuredCalls > this.maxStructuredCalls) {
      throw new Error(
        `eval must call completeStructured at most ${this.maxStructuredCalls} time(s) in this scenario — ` +
          'scoring/persistence must be zero-LLM-call pure code beyond the review-generation call itself',
      );
    }
    const review = this.reviewFor();
    return {
      data: review as unknown as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
  async embed(texts: string[]): Promise<never> {
    void texts;
    this.otherCalls.push('embed');
    throw new Error('eval must not call embed');
  }
}

// ===========================================================================
// Fixture helpers
// ===========================================================================

/** A minimal, independently-reparseable single-file unified diff whose ONE
 *  added line lands at new-side line 2 (used as the finding/expectation
 *  location throughout). */
function singleFileDiff(file: string) {
  const raw = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,2 +1,3 @@',
    ' function target() {',
    '+  doSomething();',
    ' }',
  ].join('\n');
  return parseUnifiedDiff(raw);
}

d('eval pipeline (Testcontainers pg)', () => {
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

  let seq = 0;
  const uniq = (label: string) => `${label}-${seq++}-${Date.now()}`;

  /** Insert a fresh repo + PR (+ optional pr_files patches) in `workspaceId`. */
  async function makeRepoAndPr(
    db: PgFixture['handle']['db'],
    files: { path: string; patch: string }[] = [],
  ) {
    const name = uniq('repo');
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
        title: 'Eval fixture PR',
        author: 'igorn',
        branch: 'feat/eval',
        base: 'main',
        headSha: 'evalsha1',
        additions: 1,
        deletions: 0,
        filesCount: files.length,
        status: 'open',
      })
      .returning();
    if (files.length > 0) {
      await db
        .insert(t.prFiles)
        .values(files.map((f) => ({ prId: pr!.id, path: f.path, additions: 1, deletions: 0, patch: f.patch })));
    }
    return { repo: repo!, pr: pr! };
  }

  /** Insert a review (optionally agent-less) + one finding on it. */
  async function makeReviewAndFinding(
    db: PgFixture['handle']['db'],
    prId: string,
    agentId: string | null,
    finding: {
      file: string;
      startLine: number;
      endLine: number;
      acceptedAt?: Date | null;
      dismissedAt?: Date | null;
    },
  ) {
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, kind: 'review' as const })
      .returning();
    const [findingRow] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
        severity: 'CRITICAL',
        category: 'bug',
        title: 'Fixture finding',
        rationale: 'because reasons',
        confidence: 0.9,
        acceptedAt: finding.acceptedAt ?? null,
        dismissedAt: finding.dismissedAt ?? null,
      })
      .returning();
    return { review: review!, finding: findingRow! };
  }

  // =========================================================================
  // AC-1/AC-2/AC-3/AC-4/AC-5 — case from finding
  // =========================================================================
  describe('POST /findings/:id/eval-case (AC-1/AC-2/AC-3/AC-4/AC-5)', () => {
    it('an accepted finding → one must_find item scoped to just its own file', async () => {
      const db = pg.handle.db;
      const fileA = 'src/api/foo.ts';
      const fileB = 'src/api/bar.ts';
      const { pr } = await makeRepoAndPr(db, [
        {
          path: fileA,
          patch: [
            '@@ -1,3 +1,4 @@',
            ' function foo() {',
            '-  return 1;',
            '+  return 1 + 2;',
            '+  // extra line',
            ' }',
          ].join('\n'),
        },
        {
          path: fileB,
          patch: ['@@ -5,2 +5,3 @@', ' function bar() {', "+  console.log('added');", ' }'].join('\n'),
        },
      ]);
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });
      const { finding } = await makeReviewAndFinding(db, pr.id, agent.id, {
        file: fileA,
        startLine: 2,
        endLine: 2,
        acceptedAt: new Date(),
      });

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
      expect(res.statusCode).toBe(201);

      const created = EvalCase.parse(res.json());
      expect(created.owner_kind).toBe('agent');
      expect(created.owner_id).toBe(agent.id);

      const expected = created.expected_output as Array<Record<string, unknown>>;
      expect(expected).toHaveLength(1);
      expect(expected[0]).toMatchObject({
        type: 'must_find',
        file: fileA,
        start_line: 2,
        end_line: 2,
      });

      // AC-5: input_diff/input_files scoped to fileA ONLY, never the whole PR.
      expect(created.input_diff).toContain('return 1 + 2');
      expect(created.input_diff).toContain(fileA);
      expect(created.input_diff).not.toContain(fileB);
      expect(created.input_diff).not.toContain('console.log');
      const files = created.input_files as Array<{ path: string }>;
      expect(files.map((f) => f.path)).toEqual([fileA]);

      // AC-6/AC-5: the case is a frozen, independently-stable snapshot — a
      // follow-up read returns byte-identical stored fields. A live PR
      // "resync" isn't exercised here: this codebase's resync mechanism
      // (`RepoIntelService.resyncRepo` / a fresh `POST /pulls/:id/review`)
      // touches the PR/review/finding rows, never an already-created
      // `eval_cases` row (which carries no PR/finding foreign key at all —
      // structurally nothing can cascade back into it), so the concrete,
      // automatable proof available here is "re-fetching the case returns
      // exactly what was persisted", not "resyncing the PR leaves it
      // unchanged" (which would require standing up a real GitHub adapter,
      // out of scope for this module's own routes).
      const refetch = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
      expect(refetch.statusCode).toBe(200);
      expect(EvalCase.parse(refetch.json())).toEqual(created);

      await app.close();
    });

    it('a dismissed finding → one must_not_flag item', async () => {
      const db = pg.handle.db;
      const file = 'src/api/dismissed.ts';
      const { pr } = await makeRepoAndPr(db, [
        { path: file, patch: ['@@ -1,2 +1,3 @@', ' function x() {', '+  y();', ' }'].join('\n') },
      ]);
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });
      const { finding } = await makeReviewAndFinding(db, pr.id, agent.id, {
        file,
        startLine: 2,
        endLine: 2,
        dismissedAt: new Date(),
      });

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
      expect(res.statusCode).toBe(201);
      const created = EvalCase.parse(res.json());
      const expected = created.expected_output as Array<Record<string, unknown>>;
      expect(expected).toHaveLength(1);
      expect(expected[0]).toMatchObject({ type: 'must_not_flag', file, start_line: 2 });

      await app.close();
    });

    it('a still-pending finding (neither accepted nor dismissed) → rejected, no case created', async () => {
      const db = pg.handle.db;
      const file = 'src/api/pending.ts';
      const { pr } = await makeRepoAndPr(db, [
        { path: file, patch: ['@@ -1,1 +1,2 @@', ' a();', '+b();'].join('\n') },
      ]);
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });
      const { finding } = await makeReviewAndFinding(db, pr.id, agent.id, {
        file,
        startLine: 1,
        endLine: 1,
      });

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
      expect(res.statusCode).toBe(400);

      const [caseCount] = await db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, agent.id));
      expect(caseCount).toBeUndefined();

      await app.close();
    });

    it("an agent-less review's finding → rejected (no config to score against)", async () => {
      const db = pg.handle.db;
      const file = 'src/api/agentless.ts';
      const { pr } = await makeRepoAndPr(db, [
        { path: file, patch: ['@@ -1,1 +1,2 @@', ' a();', '+b();'].join('\n') },
      ]);
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const { finding } = await makeReviewAndFinding(db, pr.id, null, {
        file,
        startLine: 1,
        endLine: 1,
        acceptedAt: new Date(),
      });

      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
      expect(res.statusCode).toBe(404);

      await app.close();
    });
  });

  // =========================================================================
  // AC-11/AC-12/AC-13 + edge case — run a batch
  // =========================================================================
  describe('POST /agents/:id/eval-runs (AC-11/AC-12/AC-13)', () => {
    it('runs the seeded case set through the real reviewer-core path, feeding STORED inputs only (zero live fetch), one eval_runs row per TARGETED case', async () => {
      const db = pg.handle.db;
      const [seededAgent] = await db
        .select()
        .from(t.agents)
        .where(eq(t.agents.name, EVAL_CASE_AGENT_NAME));
      expect(seededAgent).toBeDefined();

      const seededCases = await db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, seededAgent!.id));
      expect(seededCases.length).toBeGreaterThanOrEqual(8);

      const targetIds = seededCases.slice(0, 3).map((c) => c.id);
      const llm = new ScriptedLlm('openrouter', () => reviewFixture([]), targetIds.length);
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openrouter: llm } },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${seededAgent!.id}/eval-runs`,
        payload: { case_ids: targetIds },
      });
      expect(res.statusCode).toBe(200);

      const body = EvalRunBatchResponse.parse(res.json());
      expect(body.results).toHaveLength(3);
      expect(body.results.map((r) => r.case_id).sort()).toEqual([...targetIds].sort());
      expect(llm.structuredCalls).toBe(3);

      const rows = await db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.runBatchId, body.run_batch_id));
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(targetIds).toContain(row.caseId);
        expect(row.agentVersion).toBe(seededAgent!.version);
      }

      await app.close();
    });

    it('case_ids: [] resolves to EVERY case (the contract\'s own documented default), not zero', async () => {
      const db = pg.handle.db;
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });
      const diff = singleFileDiff('src/x.ts');
      for (const n of [1, 2]) {
        await app.inject({
          method: 'POST',
          url: `/agents/${agent.id}/eval-cases`,
          payload: {
            name: `case-${n}`,
            input_diff: diff.raw,
            input_files: diff.files,
            expected_output: [{ type: 'must_not_flag', file: 'src/x.ts', start_line: 2, end_line: 2 }],
          },
        });
      }
      const llm = new ScriptedLlm('openai', () => reviewFixture([]));
      const app2 = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openai: llm } },
      });
      const res = await app2.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-runs`,
        payload: { case_ids: [] },
      });
      expect(res.statusCode).toBe(200);
      const body = EvalRunBatchResponse.parse(res.json());
      expect(body.results).toHaveLength(2);

      await app.close();
      await app2.close();
    });

    it('an agent with zero eval cases → an empty aggregate, not an error (AC-11 edge case)', async () => {
      const db = pg.handle.db;
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: THROWING_LLM },
      });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent-no-cases'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });

      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(res.statusCode).toBe(200);
      const body = EvalRunBatchResponse.parse(res.json());
      expect(body.results).toEqual([]);
      expect(body.dashboard.cases_total).toBe(0);

      await app.close();
    });
  });

  // =========================================================================
  // AC-20/AC-21 — zero LLM calls beyond the one review-generation call
  // =========================================================================
  describe('scoring/persistence make zero further LLM calls (AC-20/AC-21)', () => {
    it('a completeStructured-budget-of-1 double still lets the run score and persist correctly', async () => {
      const db = pg.handle.db;
      const app = await buildApp({ config: config(), db, overrides: { git: throwingGit() } });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
      });
      const diff = singleFileDiff('src/scored.ts');
      const createRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'perfect-match',
          input_diff: diff.raw,
          input_files: diff.files,
          expected_output: [{ type: 'must_find', file: 'src/scored.ts', start_line: 2, end_line: 2 }],
        },
      });
      expect(createRes.statusCode).toBe(201);

      // Budget of exactly 1 completeStructured call (one case in this batch);
      // any second structured call, or ANY call to complete/embed/listModels,
      // throws — proving scoring (scoring.ts) and persistence
      // (repository.insertRun/getAgentDashboard) are pure code downstream.
      const llm = new ScriptedLlm('openai', () => reviewFixture([findingFixture('src/scored.ts', 2)]), 1);
      const app2 = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openai: llm } },
      });
      const res = await app2.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(res.statusCode).toBe(200);
      const body = EvalRunBatchResponse.parse(res.json());
      expect(body.results).toHaveLength(1);
      expect(body.results[0]!.result.recall).toBe(1);
      expect(body.results[0]!.result.precision).toBe(1);
      expect(body.results[0]!.result.traces_passed).toBe(body.results[0]!.result.traces_total);

      expect(llm.structuredCalls).toBe(1);
      expect(llm.otherCalls).toEqual([]);

      await app.close();
      await app2.close();
    });
  });

  // =========================================================================
  // AC-22 — a prompt edit visibly moves recall/precision between two runs
  // =========================================================================
  describe('a system_prompt edit moves the persisted aggregate between two runs (AC-22)', () => {
    it('run before → edit system_prompt → run after → the two runs\' recall differ', async () => {
      const db = pg.handle.db;
      let mode: 'match' | 'miss' = 'match';
      const llm = new ScriptedLlm('openai', () =>
        mode === 'match' ? reviewFixture([findingFixture('src/prompt.ts', 2)]) : reviewFixture([]),
      );
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openai: llm } },
      });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('prompt-agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'v1: flag doSomething() calls',
      });
      const diff = singleFileDiff('src/prompt.ts');
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'prompt-case',
          input_diff: diff.raw,
          input_files: diff.files,
          expected_output: [{ type: 'must_find', file: 'src/prompt.ts', start_line: 2, end_line: 2 }],
        },
      });

      mode = 'match';
      const before = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(before.statusCode).toBe(200);
      const beforeBody = EvalRunBatchResponse.parse(before.json());
      expect(beforeBody.results[0]!.result.recall).toBe(1);

      const putRes = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'v2: rule removed — no longer flags doSomething() calls' },
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().version).toBe(agent.version + 1);

      mode = 'miss';
      const after = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(after.statusCode).toBe(200);
      const afterBody = EvalRunBatchResponse.parse(after.json());
      expect(afterBody.results[0]!.result.recall).toBe(0);

      // The persisted aggregates genuinely differ between the two batches.
      expect(afterBody.results[0]!.result.recall).not.toBe(beforeBody.results[0]!.result.recall);
      expect(afterBody.dashboard.current.recall).not.toBe(beforeBody.dashboard.current.recall);
      expect(afterBody.dashboard.delta.recall).toBeLessThan(0);
      expect(afterBody.dashboard.trend.map((p) => p.agent_version)).toEqual([agent.version, agent.version + 1]);

      await app.close();
    });
  });

  // =========================================================================
  // AC-25 — must_find and must_not_flag each independently create/run/score
  // =========================================================================
  describe('must_find and must_not_flag each independently score correctly end-to-end (AC-25)', () => {
    it('a must_find case passes when the run finds it', async () => {
      const db = pg.handle.db;
      const llm = new ScriptedLlm('openai', () => reviewFixture([findingFixture('src/mf.ts', 2)]), 1);
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openai: llm } },
      });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('mf-agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'p',
      });
      const diff = singleFileDiff('src/mf.ts');
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'mf-case',
          input_diff: diff.raw,
          input_files: diff.files,
          expected_output: [{ type: 'must_find', file: 'src/mf.ts', start_line: 2, end_line: 2 }],
        },
      });

      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(res.statusCode).toBe(200);
      const body = EvalRunBatchResponse.parse(res.json());
      expect(body.results[0]!.result.recall).toBe(1);
      expect(body.results[0]!.result.precision).toBe(1);
      expect(body.results[0]!.result.traces_passed).toBe(body.results[0]!.result.traces_total);

      await app.close();
    });

    it('a must_not_flag case passes when the run stays silent on it', async () => {
      const db = pg.handle.db;
      const llm = new ScriptedLlm('openai', () => reviewFixture([]), 1);
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: { openai: llm } },
      });
      const agent = await app.container.agentsRepo.insert({
        workspaceId,
        name: uniq('mnf-agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'p',
      });
      const diff = singleFileDiff('src/mnf.ts');
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'mnf-case',
          input_diff: diff.raw,
          input_files: diff.files,
          expected_output: [{ type: 'must_not_flag', file: 'src/mnf.ts', start_line: 2, end_line: 2 }],
        },
      });

      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs`, payload: {} });
      expect(res.statusCode).toBe(200);
      const body = EvalRunBatchResponse.parse(res.json());
      // Zero must_find items → recall is vacuously 1.0; zero grounded findings
      // produced → precision is vacuously 1.0 (the "don't flag this" contract
      // was honored).
      expect(body.results[0]!.result.recall).toBe(1);
      expect(body.results[0]!.result.precision).toBe(1);
      expect(body.results[0]!.result.traces_passed).toBe(body.results[0]!.result.traces_total);

      await app.close();
    });
  });

  // =========================================================================
  // AC-39 — cross-workspace isolation
  // =========================================================================
  describe('cross-workspace access never leaks (AC-39)', () => {
    it('every eval route resolves a second workspace\'s case/run/agent as not-found or empty, never leaking data', async () => {
      const db = pg.handle.db;
      const [otherWs] = await db.insert(t.workspaces).values({ name: uniq('other-ws') }).returning();
      const [otherAgent] = await db
        .insert(t.agents)
        .values({
          workspaceId: otherWs!.id,
          name: uniq('other-agent'),
          provider: 'openai',
          model: 'gpt-4.1',
          systemPrompt: 'p',
        })
        .returning();
      const [otherCase] = await db
        .insert(t.evalCases)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'agent',
          ownerId: otherAgent!.id,
          name: 'foreign-case',
          inputDiff: '',
          expectedOutput: [],
        })
        .returning();
      await db.insert(t.evalRuns).values({
        caseId: otherCase!.id,
        runBatchId: randomUUID(),
        agentVersion: 1,
        actualOutput: [],
        pass: true,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        durationMs: 10,
        costUsd: 0.001,
      });

      // getContext always resolves the DEFAULT workspace (LocalNoAuthProvider,
      // MVP no-login mode) — so `otherWs`'s rows are unreachable through any
      // route regardless of which id is requested (server/INSIGHTS.md, 2026-07-12).
      const app = await buildApp({
        config: config(),
        db,
        overrides: { git: throwingGit(), llm: THROWING_LLM },
      });

      const getCase = await app.inject({ method: 'GET', url: `/eval-cases/${otherCase!.id}` });
      expect(getCase.statusCode).toBe(404);

      const putCase = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${otherCase!.id}`,
        payload: { name: 'hacked' },
      });
      expect(putCase.statusCode).toBe(404);

      const runBatch = await app.inject({
        method: 'POST',
        url: `/agents/${otherAgent!.id}/eval-runs`,
        payload: {},
      });
      expect(runBatch.statusCode).toBe(404);

      // These two routes have no per-id existence check (they're aggregate/
      // list reads, scoped purely by workspaceId) — the non-leaking behavior
      // here is an EMPTY result, not a 404; confirmed by reading
      // `EvalService.getAgentDashboard`/`listCasesForAgent`, neither of which
      // calls `agentsRepo.getById` before querying.
      const dashboard = await app.inject({ method: 'GET', url: `/agents/${otherAgent!.id}/eval-dashboard` });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().cases_total).toBe(0);

      const listCases = await app.inject({ method: 'GET', url: `/agents/${otherAgent!.id}/eval-cases` });
      expect(listCases.statusCode).toBe(200);
      expect(listCases.json()).toEqual([]);

      const workspaceWide = await app.inject({ method: 'GET', url: '/eval-dashboard' });
      expect(workspaceWide.statusCode).toBe(200);
      const wd = EvalWorkspaceDashboard.parse(workspaceWide.json());
      expect(wd.agents.some((a) => a.agent_id === otherAgent!.id)).toBe(false);
      expect(wd.recent_runs.some((r) => r.agent_id === otherAgent!.id)).toBe(false);

      // Delete last so the earlier reads above still had a real row to 404 against.
      const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${otherCase!.id}` });
      expect(del.statusCode).toBe(404);

      await app.close();
    });
  });
});
