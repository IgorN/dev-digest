/**
 * Why + Risk Brief — end to end (Docker-gated, mirrors blast.it.test.ts's
 * harness: startPg/dockerAvailable/buildApp/loadConfig/seed/app.inject).
 *
 * Covers, each as its own `it`: the feature's ONE `completeStructured` call
 * proven with a recording `LLMProvider` double (AC-1/AC-2), the zero-model
 * read/cache path proven with an always-throwing double (AC-3), the
 * null-body contract for a never-computed brief (AC-4), degrade-never-5xx
 * across every missing-input combination (AC-8/AC-9/AC-10/AC-13) and a
 * failed synthesis call (AC-11), that a recompute actually persists (AC-19),
 * and workspace scoping (AC-20).
 *
 * Every recompute test explicitly overrides BOTH `llm` (under the `openai`
 * key — `risk_brief`'s registry default, confirmed in
 * vendor/shared/contracts/platform.ts) and `github` (an always-throwing
 * double by default) so the suite never depends on — or risks calling — the
 * developer machine's real ambient secrets/API. `git`/clonePath is only
 * exercised (via a `MockGitClient`) in the one test that deliberately wants
 * "all 5 inputs present"; every other test leaves `clonePath: null` so
 * `ContextService.inventory` short-circuits before touching `container.git`
 * at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitHubClient, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { LLM_FAILURE_REASON, DEGRADED_SKELETON_RISK_LEVEL } from '../src/modules/why-risk-brief/constants.js';
import * as t from '../src/db/schema.js';
import {
  WhyRiskBrief,
  type LLMProvider,
  type GitHubClient,
  type GitClient,
  type BlastRadius,
  type Intent,
  type Risk,
  type ReviewFocusItem,
  type Finding,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[why-risk-brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DEFAULT_FILE = 'src/middleware/ratelimit.ts';

/**
 * An LLMProvider double whose every method throws — the established
 * zero/one-LLM-call proof (server/INSIGHTS.md 2026-07-12), mirroring
 * smart-diff.it.test.ts's `throwingLlmProvider`.
 */
function throwingLlmProvider(id: 'openai' | 'anthropic' | 'openrouter'): LLMProvider {
  const boom = (): never => {
    throw new Error(`why-risk-brief must never call the ${id} LLM provider here`);
  };
  return {
    id,
    listModels: async () => boom(),
    complete: async () => boom(),
    completeStructured: async () => boom(),
    embed: async () => boom(),
  };
}

/**
 * A GitHubClient double whose every method throws — the default "no linked
 * issue, and definitely never the real GitHub API" input for recompute
 * tests that aren't specifically exercising the linked-issue input.
 */
function throwingGitHubClient(): GitHubClient {
  const boom = (): never => {
    throw new Error('why-risk-brief must not call the real GitHub client in this test');
  };
  return {
    listPullRequests: async () => boom(),
    getPullRequest: async () => boom(),
    postReview: async () => boom(),
    listReviewComments: async () => boom(),
    createReviewComment: async () => boom(),
    openPullRequest: async () => boom(),
    commitFiles: async () => boom(),
    findOpenPr: async () => boom(),
    getIssue: async () => boom(),
    currentLogin: async () => boom(),
  };
}

interface GeneratedBriefFixture {
  what: string;
  why: string;
  risk_level: 'high' | 'medium' | 'low';
  risks: Risk[];
  review_focus: ReviewFocusItem[];
}

/**
 * A valid `GeneratedBrief`-shaped fixture (synthesize.ts's local schema:
 * what/why/risk_level/risks/review_focus) for `MockLLMProvider`'s
 * `structured` option — validated against that schema on every
 * `completeStructured` call, so an invalid override throws loudly.
 */
function briefFixture(
  overrides: Partial<Pick<GeneratedBriefFixture, 'risks' | 'review_focus'>> = {},
): GeneratedBriefFixture {
  return {
    what: 'Adds token-bucket rate limiting to public API endpoints.',
    why: 'Prevents abuse from unauthenticated clients.',
    risk_level: 'medium',
    risks: overrides.risks ?? [
      {
        kind: 'correctness',
        title: 'Fixed bucket size may drop legitimate bursts',
        explanation: 'The limiter uses one fixed bucket size for every route.',
        severity: 'medium',
        file_refs: [DEFAULT_FILE],
      },
    ],
    review_focus: overrides.review_focus ?? [{ file: DEFAULT_FILE, line: 10, reason: 'Core limiter logic' }],
  };
}

/** A minimal valid `Finding` (AD-5 test fixture) — only `severity` varies. */
function findingFixture(overrides: Partial<Pick<Finding, 'severity'>> = {}): Finding {
  return {
    id: crypto.randomUUID(),
    severity: overrides.severity ?? 'CRITICAL',
    category: 'bug',
    title: 'Fixture finding',
    file: DEFAULT_FILE,
    start_line: 1,
    end_line: 1,
    rationale: 'Fixture rationale.',
    confidence: 0.9,
  };
}

d('why + risk brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let reviewRepo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    reviewRepo = new ReviewRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  let repoSeq = 0;
  async function setupPr(
    opts: {
      clonePath?: string | null;
      files?: { path: string; additions: number; deletions: number }[];
    } = {},
  ) {
    const name = `wrb-repo-${repoSeq++}`;
    const files = opts.files ?? [{ path: DEFAULT_FILE, additions: 84, deletions: 0 }];
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        clonePath: opts.clonePath ?? null,
      })
      .returning();
    const [pull] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values(files.map((f) => ({ prId: pull!.id, ...f })));
    return { repo: repo!, pull: pull!, files };
  }

  /**
   * Build an app for a `recompute` call. Always injects `llm` under the
   * `openai` key (risk_brief's registry default) and defaults `github` to an
   * always-throwing double, so a test that doesn't care about the linked
   * issue never depends on — or risks calling — the real GitHub API.
   */
  async function appForRecompute(opts: { llm: LLMProvider; github?: GitHubClient; git?: GitClient }) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openai: opts.llm },
        github: opts.github ?? throwingGitHubClient(),
        ...(opts.git ? { git: opts.git } : {}),
      },
    });
  }

  const BLAST_FIXTURE: BlastRadius = {
    changed_symbols: [{ name: 'rateLimit', file: DEFAULT_FILE, kind: 'function' }],
    downstream: [
      {
        symbol: 'rateLimit',
        callers: [{ name: 'webhooksHandler', file: 'src/api/public/webhooks.ts', line: 45 }],
        endpoints_affected: ['POST /api/public/webhooks'],
        crons_affected: [],
      },
    ],
    summary: 'Rate limiting now guards public endpoints.',
    degraded: false,
    degraded_reason: null,
  };

  const INTENT_FIXTURE: Intent = {
    intent: 'Add token-bucket rate limiting to public API endpoints.',
    in_scope: ['rate limiting middleware'],
    out_of_scope: ['authentication changes'],
  };

  it('AC-1: recompute with all 5 inputs available makes exactly one completeStructured call and returns a valid WhyRiskBrief', async () => {
    const { pull } = await setupPr({ clonePath: '/mock/clone/acme/wrb-allinputs' });
    await reviewRepo.upsertIntent(pull.id, INTENT_FIXTURE);
    await reviewRepo.upsertBriefBlast(pull.id, BLAST_FIXTURE);
    // smart-diff group counts are always derived from the PR's current files
    // (no persistence needed) — setupPr's inserted file covers that input.

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const github = new MockGitHubClient({
      detail: {
        linked_issue: {
          number: 471,
          title: 'Public endpoints get hammered by unauthenticated clients',
          body: 'Multiple abuse reports this week.',
          state: 'open',
        },
      },
    });
    const git = new MockGitClient({
      files: { 'docs/architecture.md': '# Architecture\n\nRate limiting lives in the middleware layer.' },
    });

    const app = await appForRecompute({ llm, github, git });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = WhyRiskBrief.parse(res.json());
    expect(body.degraded).toBe(false);

    // AD-4: cost/token accounting from the one synthesis call is persisted,
    // not just logged — MockLLMProvider's completeStructured always returns
    // the same fixed tokensIn/tokensOut/costUsd (src/adapters/mocks.ts).
    expect(body.tokens_in).toBe(100);
    expect(body.tokens_out).toBe(50);
    expect(body.cost_usd).toBe(0.001);

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.method).toBe('completeStructured');
    expect((llm.calls[0]!.req as { schemaName: string }).schemaName).toBe('WhyRiskBrief');

    await app.close();
  });

  it('AC-2: recompute reads persisted intent/blast without triggering any additional intent/blast/smart-diff model call', async () => {
    const { pull } = await setupPr();
    await reviewRepo.upsertIntent(pull.id, INTENT_FIXTURE);
    await reviewRepo.upsertBriefBlast(pull.id, BLAST_FIXTURE);

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    // Every recorded call — not just the count — is the ONE WhyRiskBrief
    // synthesis call; no intent-extraction / blast-summary / smart-diff call
    // shows up even though intent and blast were both persisted and read.
    expect(llm.calls).toHaveLength(1);
    for (const call of llm.calls) {
      expect(call.method).toBe('completeStructured');
      expect((call.req as { schemaName: string }).schemaName).toBe('WhyRiskBrief');
    }

    await app.close();
  });

  it('AD-5: existing-review findings (deduped, kind="review" only) roll up into the assembled prompt', async () => {
    const { pull } = await setupPr();

    // A 'summary'-kind review's CRITICAL finding must NOT count (mirrors the
    // PR-list route's own kind:'review' filter) — if it wrongly counted, the
    // assertion below would see "2 critical" instead of "1 critical".
    const summaryReview = await reviewRepo.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: null,
      runId: null,
      kind: 'summary',
      verdict: null,
      summary: 'A summary-kind review, not a line-level one.',
      score: null,
      model: null,
    });
    await reviewRepo.insertFindings(summaryReview.id, [findingFixture({ severity: 'CRITICAL' })]);

    const review = await reviewRepo.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: 'request_changes',
      summary: null,
      score: 40,
      model: null,
    });
    await reviewRepo.insertFindings(review.id, [
      findingFixture({ severity: 'CRITICAL' }),
      findingFixture({ severity: 'WARNING' }),
    ]);

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    expect(llm.calls).toHaveLength(1);
    const messages = (llm.calls[0]!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!;
    expect(userMessage.content).toContain('## Existing review findings');
    expect(userMessage.content).toContain('1 critical, 1 warning, 0 suggestion');

    await app.close();
  });

  it('AC-3: GET on a PR with a persisted brief returns it with zero model calls (always-throwing double)', async () => {
    const { pull } = await setupPr();
    const persisted: WhyRiskBrief = { ...briefFixture(), degraded: false, degraded_reason: null };
    await reviewRepo.upsertBriefWhyRisk(pull.id, persisted);

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: throwingLlmProvider('openai') } },
    });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pull.id}/why-risk-brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(persisted);

    await app.close();
  });

  it('AC-4: GET on a PR that has never had a brief computed returns 200 with a null body', async () => {
    const { pull } = await setupPr();
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pull.id}/why-risk-brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });

  it('AC-8: recompute on a PR with no persisted intent still returns a valid, non-degraded brief', async () => {
    const { pull } = await setupPr();
    await reviewRepo.upsertBriefBlast(pull.id, BLAST_FIXTURE); // blast IS present; only intent is missing

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = WhyRiskBrief.parse(res.json());
    expect(body.degraded).toBe(false);

    await app.close();
  });

  it('AC-9: recompute with no persisted blast still returns 200, grounding every file_refs/review_focus.file in the PR diff files', async () => {
    const { pull, files } = await setupPr(); // no blast persisted -> grounding set is diff files only
    const diffFiles = new Set(files.map((f) => f.path));

    const fixture = briefFixture({
      risks: [
        {
          kind: 'correctness',
          title: 'Limiter change touches a shared path',
          explanation: 'One real ref, one path that would only be valid if a blast map were present.',
          severity: 'medium',
          file_refs: [DEFAULT_FILE, 'src/api/public/items.ts'],
        },
      ],
      review_focus: [
        { file: DEFAULT_FILE, line: 10, reason: 'Core limiter logic' },
        { file: 'src/api/public/items.ts', line: 5, reason: 'Only reachable via blast, which is absent here' },
      ],
    });
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = WhyRiskBrief.parse(res.json());

    for (const risk of body.risks) {
      for (const ref of risk.file_refs) expect(diffFiles.has(ref)).toBe(true);
    }
    for (const item of body.review_focus) expect(diffFiles.has(item.file)).toBe(true);

    // Concretely: the fabricated (blast-only) ref/item are gone, the real one survives.
    expect(body.risks[0]!.file_refs).toEqual([DEFAULT_FILE]);
    expect(body.review_focus).toHaveLength(1);
    expect(body.review_focus[0]!.file).toBe(DEFAULT_FILE);

    await app.close();
  });

  it('AC-10: recompute with no linked issue and no context docs still returns 200', async () => {
    const { pull } = await setupPr(); // clonePath null (default) -> no clone; github double throws -> no linked issue
    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    WhyRiskBrief.parse(res.json());

    await app.close();
  });

  it('AC-11: a failed synthesis call (always-throwing double) returns 200 with a degraded skeleton, never a 5xx', async () => {
    const { pull } = await setupPr();
    const app = await appForRecompute({ llm: throwingLlmProvider('openai') });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = WhyRiskBrief.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.degraded_reason).toBe(LLM_FAILURE_REASON);
    expect(body.risk_level).toBe(DEGRADED_SKELETON_RISK_LEVEL);
    expect(body.risks).toEqual([]);
    expect(body.review_focus).toEqual([]);
    // AD-4: no successful synthesis call was made, so no cost/tokens to report.
    expect(body.tokens_in).toBeNull();
    expect(body.tokens_out).toBeNull();
    expect(body.cost_usd).toBeNull();

    await app.close();
  });

  it('AC-13: recompute against the seeded acme/payments-api (clonePath: null) returns 200', async () => {
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    expect(repo).toBeTruthy();
    expect(repo!.clonePath).toBeNull();
    const [pull] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    expect(pull).toBeTruthy();

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull!.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    WhyRiskBrief.parse(res.json());

    await app.close();
  });

  it('AC-19: recompute persists the fresh brief — a subsequent GET (always-throwing double) returns the same brief', async () => {
    const { pull } = await setupPr();
    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const appA = await appForRecompute({ llm });
    const recomputeRes = await appA.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(recomputeRes.statusCode).toBe(200);
    const recomputed = WhyRiskBrief.parse(recomputeRes.json());
    await appA.close();

    const appB = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: throwingLlmProvider('openai') } },
    });
    const getRes = await appB.inject({ method: 'GET', url: `/pulls/${pull.id}/why-risk-brief` });
    expect(getRes.statusCode).toBe(200);
    expect(WhyRiskBrief.parse(getRes.json())).toEqual(recomputed);
    await appB.close();
  });

  it('T2: upsertBriefWhyRisk read-merge-writes — a pre-existing blast sibling key survives', async () => {
    const { pull } = await setupPr();
    await reviewRepo.upsertBriefBlast(pull.id, BLAST_FIXTURE);

    const llm = new MockLLMProvider('openai', { structured: briefFixture() });
    const app = await appForRecompute({ llm });
    const recomputeRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pull.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(recomputeRes.statusCode).toBe(200);
    await app.close();

    // upsertBriefWhyRisk spreads the existing row before writing `why_risk` —
    // confirm that read-merge-write didn't clobber the `blast` key written
    // before it, by reading it back directly via the repository.
    await expect(reviewRepo.getBriefBlast(pull.id)).resolves.toEqual(BLAST_FIXTURE);
  });

  it('AC-20: a PR in a different workspace resolves not-found on both GET and recompute', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'acme', name: `foreign-${Date.now()}`, fullName: 'acme/foreign-wrb' })
      .returning();
    const [pull] = await db
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
      })
      .returning();

    // getContext always resolves the DEFAULT workspace (LocalNoAuthProvider,
    // MVP no-login mode) — so a PR that lives in `otherWs` is unreachable
    // through either route regardless of which id is requested.
    const app = await buildApp({ config: config(), db });

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pull!.id}/why-risk-brief` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pull!.id}/why-risk-brief/recompute`,
      payload: {},
    });
    expect(postRes.statusCode).toBe(404);

    await app.close();
  });
});
