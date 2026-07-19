import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { ContextInventory, type RepoRef, type Review, type RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-edges] Docker not available — skipping integration tests.');
}

/**
 * Project Context — integration edge cases NOT covered by context.it.test.ts /
 * context-persistence.it.test.ts / reviews-context.it.test.ts:
 *   (1) unusual-but-safe file names (spaces, non-ASCII) survive the FULL
 *       inventory → preview → persist → inject pipeline unmangled,
 *   (2) run-time injection is root-agnostic: an attached path that does not
 *       match the CURRENT CONTEXT_ROOTS still injects (attach/save-time is
 *       root-agnostic too), while the reader endpoints exclude/refuse it —
 *       i.e. a CONTEXT_ROOTS change never silently drops stale attachments,
 *   (3) a duplicate-containing resubmit that normalizes to the stored set is a
 *       version NO-OP, while a duplicate-containing REORDER cuts exactly one
 *       version holding the deduped order,
 *   (4) clearing attachments (POST []) persists [] (distinct from the
 *       never-attached null) and cuts a version; POST [] on a fresh agent
 *       stays null with no version cut.
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

/** Real-SimpleGitClient-like readFile: throws ENOENT for an unknown path. */
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

const SPACED_PATH = 'docs/design notes.md';
const UNICODE_PATH = 'docs/архитектура каталога.md';

const DOCS: Record<string, string> = {
  'docs/agent-a.md': '# Agent doc A\nAGENT-DOC-A body.',
  [SPACED_PATH]: '# Design notes\nSPACED-NAME body.',
  [UNICODE_PATH]: '# Архитектура\nUNICODE-NAME body.',
};

let repoSeq = 0;

d('project context edge cases (Testcontainers pg)', () => {
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

  function makeApp(extraEnv: Record<string, string> = {}) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      ...extraEnv,
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new CloneGitClient(DOCS),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupRepoAndPr() {
    const name = `ctx-edge-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: `/mock/clones/acme/${name}`,
      })
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

  async function createAgent(app: App): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `CtxEdge-${Math.random()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'rev',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function setDocs(app: App, agentId: string, paths: string[]) {
    return app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths },
    });
  }

  async function agentVersions(app: App, agentId: string) {
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
    expect(res.statusCode).toBe(200);
    return res.json() as Array<{ version: number; config: { context_documents?: string[] } }>;
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

  it('(1) spaced + non-ASCII file names flow inventory → preview → persist → inject unmangled', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupRepoAndPr();

    // Inventory lists both, exact strings, under the docs root.
    const inv = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(inv.statusCode).toBe(200);
    const body = ContextInventory.parse(inv.json());
    const byPath = new Map(body.items.map((i) => [i.path, i]));
    for (const path of [SPACED_PATH, UNICODE_PATH]) {
      const item = byPath.get(path);
      expect(item, `inventory should list ${path}`).toBeTruthy();
      expect(item!.root).toBe('docs');
      expect(item!.token_estimate).toBeGreaterThan(0);
    }

    // Preview round-trips the exact content through URL encoding.
    for (const path of [SPACED_PATH, UNICODE_PATH]) {
      const prev = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/document?path=${encodeURIComponent(path)}`,
      });
      expect(prev.statusCode).toBe(200);
      expect(prev.json().path).toBe(path);
      expect(prev.json().content).toBe(DOCS[path]);
    }

    // Persist both on an agent — stored byte-for-byte.
    const agentId = await createAgent(app);
    const set = await setDocs(app, agentId, [SPACED_PATH, UNICODE_PATH]);
    expect(set.statusCode).toBe(200);
    expect(set.json().context_documents).toEqual([SPACED_PATH, UNICODE_PATH]);

    // Run: both inject, exact paths in the trace, contents in the specs block.
    const { trace } = await runAndGetTrace(app, pr.id, agentId);
    expect(trace.specs_read).toEqual([SPACED_PATH, UNICODE_PATH]);
    expect(trace.specs_injected).toEqual([
      { path: SPACED_PATH, tokens: Math.ceil(DOCS[SPACED_PATH]!.length / 4), status: 'injected' },
      { path: UNICODE_PATH, tokens: Math.ceil(DOCS[UNICODE_PATH]!.length / 4), status: 'injected' },
    ]);
    expect(trace.prompt_assembly.specs).toContain('SPACED-NAME body.');
    expect(trace.prompt_assembly.specs).toContain('UNICODE-NAME body.');

    await app.close();
  });

  it('(2) an attachment outside the CURRENT CONTEXT_ROOTS still injects at run time (reader excludes it)', async () => {
    // Roots overridden to `adr` — every doc in the clone lives under docs/.
    const app = await makeApp({ CONTEXT_ROOTS: 'adr' });
    const { repo, pr } = await setupRepoAndPr();

    // Save-time validation is root-agnostic (safety + markdown only): the
    // attach succeeds even though docs/ is not a configured root here — the
    // same state a CONTEXT_ROOTS change leaves a pre-existing attachment in.
    const agentId = await createAgent(app);
    const set = await setDocs(app, agentId, ['docs/agent-a.md']);
    expect(set.statusCode).toBe(200);

    // The reader endpoints DO honor the current roots: inventory excludes it…
    const inv = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(inv.statusCode).toBe(200);
    expect(ContextInventory.parse(inv.json()).items).toEqual([]);
    // …and preview refuses it.
    const prev = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/document?path=${encodeURIComponent('docs/agent-a.md')}`,
    });
    expect(prev.statusCode).toBe(422);

    // But the run still injects the stale attachment (run path guards safety,
    // not root membership) — no silent drop, and the trace shows it plainly.
    const { runId, trace } = await runAndGetTrace(app, pr.id, agentId);
    expect(trace.specs_read).toEqual(['docs/agent-a.md']);
    expect(trace.specs_injected).toEqual([
      {
        path: 'docs/agent-a.md',
        tokens: Math.ceil(DOCS['docs/agent-a.md']!.length / 4),
        status: 'injected',
      },
    ]);
    expect(trace.prompt_assembly.specs).toContain('AGENT-DOC-A body.');
    const runs = await waitForPrRuns(pg.handle.db, pr.id);
    expect(runs.find((r) => r.id === runId)!.status).toBe('done');

    await app.close();
  });

  it('(3) dup-containing resubmit of the stored set is a version NO-OP; dup-containing reorder cuts ONE version', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    // v2: first attach.
    expect((await setDocs(app, agentId, ['docs/a.md', 'docs/b.md'])).statusCode).toBe(200);
    expect(await agentVersions(app, agentId)).toHaveLength(2);

    // Resubmit WITH a duplicate — normalizes to the stored set → no version.
    const resubmit = await setDocs(app, agentId, ['docs/a.md', 'docs/b.md', 'docs/a.md']);
    expect(resubmit.statusCode).toBe(200);
    expect(resubmit.json().context_documents).toEqual(['docs/a.md', 'docs/b.md']);
    expect(await agentVersions(app, agentId)).toHaveLength(2);

    // Reorder WITH a duplicate — normalizes to a NEW order → exactly one more
    // version whose snapshot carries the deduped, reordered set.
    const reorder = await setDocs(app, agentId, ['docs/b.md', 'docs/a.md', 'docs/b.md']);
    expect(reorder.statusCode).toBe(200);
    expect(reorder.json().context_documents).toEqual(['docs/b.md', 'docs/a.md']);
    const versions = await agentVersions(app, agentId);
    expect(versions).toHaveLength(3);
    expect(versions[0]!.config.context_documents).toEqual(['docs/b.md', 'docs/a.md']);

    await app.close();
  });

  it('(4) POST [] clears to [] (vs never-attached null) and cuts a version; [] on a fresh agent is a no-op', async () => {
    const app = await makeApp();

    // Fresh agent, never attached: POST [] is a no-op — stays null, v1 only.
    const freshId = await createAgent(app);
    const freshClear = await setDocs(app, freshId, []);
    expect(freshClear.statusCode).toBe(200);
    expect(freshClear.json().context_documents).toBeNull();
    expect(await agentVersions(app, freshId)).toHaveLength(1);

    // Attach then clear: stored value becomes [] (a real detach-all), one
    // version cut whose snapshot records the empty set.
    const agentId = await createAgent(app);
    expect((await setDocs(app, agentId, ['docs/a.md'])).statusCode).toBe(200);
    const clear = await setDocs(app, agentId, []);
    expect(clear.statusCode).toBe(200);
    expect(clear.json().context_documents).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json().context_documents,
    ).toEqual([]);
    const versions = await agentVersions(app, agentId);
    expect(versions).toHaveLength(3); // create, attach, clear
    expect(versions[0]!.config.context_documents).toEqual([]);

    await app.close();
  });
});
