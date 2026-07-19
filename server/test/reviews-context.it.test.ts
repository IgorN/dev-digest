import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { approxTokens, truncateToBytes } from '../src/modules/context/helpers.js';
import { TRUNCATION_MARKER } from '../src/modules/context/constants.js';
import * as t from '../src/db/schema.js';
import type { LLMProvider, RepoRef, Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-context] Docker not available — skipping integration tests.');
}

/**
 * T5 — Project Context injection at review-run time (AC-7/8/10/11/12/15/16/17/18).
 * A run assembles the agent's own + enabled-skill-inherited docs (AC-8 order,
 * dedup), reads them from the clone, and passes them as `specs` — recorded in
 * `specs_read` + the new `specs_injected` on the trace. An empty set leaves the
 * prompt byte-for-byte at the pre-feature baseline.
 */

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/**
 * Git double matching the REAL SimpleGitClient's readFile contract: it throws
 * (fs ENOENT) for a path not present in the clone. MockGitClient's default
 * (`'' ` for unknown paths, never throws) would silently turn the AC-16
 * skipped_missing branch into an empty injected doc.
 */
class CloneGitClient extends MockGitClient {
  constructor(private docs: Record<string, string>) {
    super({ diff: DIFF, files: docs });
  }
  override async readFile(_repo: RepoRef, path: string): Promise<string> {
    const content = this.docs[path];
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: 'ENOENT',
      });
    }
    return content;
  }
}

/** LLM double whose every method throws — proves a path makes zero LLM calls. */
class ThrowingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels(): Promise<never> {
    throw new Error('LLM called: listModels');
  }
  async complete(): Promise<never> {
    throw new Error('LLM called: complete');
  }
  async completeStructured(): Promise<never> {
    throw new Error('LLM called: completeStructured');
  }
  async embed(): Promise<never> {
    throw new Error('LLM called: embed');
  }
}

const DOCS: Record<string, string> = {
  'docs/agent-a.md': '# Agent doc A\nAGENT-DOC-A body.',
  'docs/shared.md': '# Shared doc\nSHARED-DOC body.',
  'specs/skill-one.md': '# Skill1 doc\nSKILL-ONE-DOC body.',
  'insights/skill-two.md': '# Skill2 doc\nSKILL-TWO-DOC body.',
  'docs/big.md': '# Big\n' + 'y'.repeat(2000),
};

let repoSeq = 0;

d('reviews Project Context injection (Testcontainers pg)', () => {
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

  function makeApp(opts: { maxBytes?: number; throwingLlm?: boolean } = {}) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      ...(opts.maxBytes ? { CONTEXT_DOC_MAX_BYTES: String(opts.maxBytes) } : {}),
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new CloneGitClient(DOCS),
        llm: {
          openai: opts.throwingLlm
            ? new ThrowingLLMProvider()
            : new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
        },
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupRepoAndPr() {
    const name = `ctx-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function createAgent(app: App, contextDocuments?: string[]): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Ctx-${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    if (contextDocuments) {
      const set = await app.inject({
        method: 'POST',
        url: `/agents/${id}/context-documents`,
        payload: { paths: contextDocuments },
      });
      expect(set.statusCode).toBe(200);
    }
    return id;
  }

  async function createSkill(app: App, contextDocuments: string[]): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `CtxSkill-${Math.random()}`, type: 'custom', body: 'Check errors.' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const set = await app.inject({
      method: 'POST',
      url: `/skills/${id}/context-documents`,
      payload: { paths: contextDocuments },
    });
    expect(set.statusCode).toBe(200);
    return id;
  }

  async function runAndGetTrace(app: App, prId: string, agentId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
    const traceRes = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    expect(traceRes.statusCode).toBe(200);
    return { runId, trace: traceRes.json() as RunTrace };
  }

  it('(a+b) agent-own + skill-inherited docs inject deduped in AC-8 order, each wrapped untrusted', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();

    // Agent: [agent-a, shared]; skill1: [shared, skill-one] (shared dedups to
    // its agent-level slot); skill2: [skill-two]. Link order: skill1, skill2.
    const agentId = await createAgent(app, ['docs/agent-a.md', 'docs/shared.md']);
    const skill1 = await createSkill(app, ['docs/shared.md', 'specs/skill-one.md']);
    const skill2 = await createSkill(app, ['insights/skill-two.md']);
    const link = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skill1, skill2] },
    });
    expect(link.statusCode).toBe(200);

    const { trace } = await runAndGetTrace(app, pr.id, agentId);

    // AC-8 / AC-12: every path once, first-occurrence order, agent docs first.
    expect(trace.specs_read).toEqual([
      'docs/agent-a.md',
      'docs/shared.md',
      'specs/skill-one.md',
      'insights/skill-two.md',
    ]);
    expect(trace.specs_injected).toEqual([
      { path: 'docs/agent-a.md', tokens: approxTokens(DOCS['docs/agent-a.md']!.length), status: 'injected' },
      { path: 'docs/shared.md', tokens: approxTokens(DOCS['docs/shared.md']!.length), status: 'injected' },
      { path: 'specs/skill-one.md', tokens: approxTokens(DOCS['specs/skill-one.md']!.length), status: 'injected' },
      { path: 'insights/skill-two.md', tokens: approxTokens(DOCS['insights/skill-two.md']!.length), status: 'injected' },
    ]);

    // AC-10: the assembled specs block holds the CONTENT, in assembled order.
    const specs = trace.prompt_assembly.specs;
    expect(specs).toBeTruthy();
    const order = [
      'AGENT-DOC-A body.',
      'SHARED-DOC body.',
      'SKILL-ONE-DOC body.',
      'SKILL-TWO-DOC body.',
    ].map((marker) => specs!.indexOf(marker));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // Dedup: the shared doc's body appears exactly once.
    expect(specs!.split('SHARED-DOC body.').length - 1).toBe(1);

    // AC-11: each doc sits in its own <untrusted source="spec-N"> wrapper, and
    // the block lands in the user prompt under ## Project context.
    for (let i = 0; i < 4; i++) expect(specs).toContain(`<untrusted source="spec-${i}">`);
    expect(specs).not.toContain('<untrusted source="spec-4">');
    expect(trace.prompt_assembly.user).toContain('## Project context');

    await app.close();
  });

  it('(c) a since-deleted path is skipped_missing; the others inject and the run completes', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();
    const agentId = await createAgent(app, [
      'docs/agent-a.md',
      'docs/deleted-since-attach.md', // not in the clone → real git throws ENOENT
      'specs/skill-one.md',
    ]);

    const { runId, trace } = await runAndGetTrace(app, pr.id, agentId);

    expect(trace.specs_read).toEqual(['docs/agent-a.md', 'specs/skill-one.md']);
    expect(trace.specs_injected).toEqual([
      { path: 'docs/agent-a.md', tokens: approxTokens(DOCS['docs/agent-a.md']!.length), status: 'injected' },
      { path: 'docs/deleted-since-attach.md', tokens: 0, status: 'skipped_missing' },
      { path: 'specs/skill-one.md', tokens: approxTokens(DOCS['specs/skill-one.md']!.length), status: 'injected' },
    ]);
    expect(trace.prompt_assembly.specs).toContain('AGENT-DOC-A body.');
    expect(trace.prompt_assembly.specs).not.toContain('deleted-since-attach');

    // AC-16: the run still completed normally.
    const runs = await waitForPrRuns(pg.handle.db, pr.id);
    expect(runs.find((r) => r.id === runId)!.status).toBe('done');

    await app.close();
  });

  it('(d) an oversized doc is truncated at the cap; tokens count the truncated content', async () => {
    const cap = 256;
    const app = await makeApp({ maxBytes: cap });
    const { pr } = await setupRepoAndPr();
    const agentId = await createAgent(app, ['docs/big.md']);

    const { trace } = await runAndGetTrace(app, pr.id, agentId);

    const expected = truncateToBytes(DOCS['docs/big.md']!, cap);
    expect(expected.truncated).toBe(true);
    expect(trace.specs_read).toEqual(['docs/big.md']);
    expect(trace.specs_injected).toEqual([
      { path: 'docs/big.md', tokens: approxTokens(expected.text.length), status: 'truncated' },
    ]);
    // Tokens reflect the truncated length, not the full 2000+ char doc.
    expect(trace.specs_injected![0]!.tokens).toBeLessThan(
      approxTokens(DOCS['docs/big.md']!.length),
    );
    // The injected block carries the visible truncation marker (AC-18).
    expect(trace.prompt_assembly.specs).toContain(TRUNCATION_MARKER);

    await app.close();
  });

  it('(e) empty assembled set → prompt_assembly.specs null, no ## Project context section (AC-17)', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();
    const agentId = await createAgent(app); // nothing attached, no skills

    const { trace } = await runAndGetTrace(app, pr.id, agentId);

    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    expect(trace.specs_injected ?? null).toBeNull();

    await app.close();
  });

  it("(f) a DISABLED linked skill's docs are omitted from the set", async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();
    const agentId = await createAgent(app, ['docs/agent-a.md']);
    const skillId = await createSkill(app, ['specs/skill-one.md']);
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });
    const disable = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}`,
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);

    const { trace } = await runAndGetTrace(app, pr.id, agentId);

    expect(trace.specs_read).toEqual(['docs/agent-a.md']);
    expect(trace.prompt_assembly.specs).not.toContain('SKILL-ONE-DOC body.');

    await app.close();
  });

  it('(g) AC-15: with a throwing LLM double the assembly still runs — the FAILURE trace records it', async () => {
    const app = await makeApp({ throwingLlm: true });
    const { pr } = await setupRepoAndPr();
    const agentId = await createAgent(app, ['docs/agent-a.md', 'docs/missing.md']);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    // The run fails at the LLM call — AFTER context assembly (zero LLM calls
    // in the assembly itself, or it would have failed before assembling).
    expect(runs.find((r) => r.id === runId)!.status).toBe('failed');

    // The failure-path trace (traceFromBuffer) carries the assembled context.
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json() as RunTrace;
    expect(trace.specs_read).toEqual(['docs/agent-a.md']);
    expect(trace.specs_injected).toEqual([
      { path: 'docs/agent-a.md', tokens: approxTokens(DOCS['docs/agent-a.md']!.length), status: 'injected' },
      { path: 'docs/missing.md', tokens: 0, status: 'skipped_missing' },
    ]);

    await app.close();
  });
});
