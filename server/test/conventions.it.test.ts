import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const USERS_FILE = `import { db } from "../lib/db";

export async function getUserWithPosts(id: string) {
  const user = await db.users.find(id);
  const posts = await db.posts.findMany({ userId: id });
  return { ...user, posts };
}
`;

// One valid candidate (anchor IS in the seeded file, line 5) + one hallucinated path.
const CANDIDATES_FIXTURE = {
  candidates: [
    {
      category: 'async',
      rule: 'Use async/await; never .then() chains.',
      evidence_path: 'src/api/users.ts',
      evidence_anchor: 'db.posts.findMany',
      confidence: 0.92,
    },
    {
      category: 'other',
      rule: 'This rule has no real evidence.',
      evidence_path: 'src/does-not-exist.ts',
      evidence_anchor: 'fabricatedThing',
      confidence: 0.5,
    },
  ],
};

d('conventions extractor (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, gitFiles?: Record<string, string>) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(gitFiles ? { files: gitFiles } : {}),
        llm: { openrouter: new MockLLMProvider('openrouter', { structured }) },
      },
    });
  }

  let repoSeq = 0;
  async function setupRepo() {
    const name = `conv-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, defaultBranch: 'main' })
      .returning();
    await pg.handle.db
      .insert(t.codeChunks)
      .values({ workspaceId, repoId: repo!.id, path: 'src/api/users.ts', content: USERS_FILE, source: 'code' });
    return repo!;
  }

  it('extract: verifies evidence — keeps the real candidate, drops the hallucinated path', async () => {
    const app = await appWith(CANDIDATES_FIXTURE);
    const repo = await setupRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proposed).toBe(2);
    expect(body.verified).toBe(1);
    expect(body.sample_count).toBeGreaterThanOrEqual(1);
    expect(body.candidates).toHaveLength(1);

    const c = body.candidates[0];
    expect(c.evidence_path).toBe('src/api/users.ts');
    expect(c.evidence_start_line).toBe(5); // line of the matched snippet
    expect(c.accepted).toBeNull(); // undecided after a fresh scan
    expect(c.evidence_url).toBe(
      `https://github.com/acme/${repo.name}/blob/main/src/api/users.ts#L5`,
    );

    await app.close();
  });

  it('accept/reject + bulk + skill-draft only includes accepted', async () => {
    const app = await appWith(CANDIDATES_FIXTURE);
    const repo = await setupRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract`, payload: {} });

    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json();
    expect(list.candidates).toHaveLength(1);
    const id = list.candidates[0].id;

    // reject → not in the draft
    await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { accepted: false } });
    let draft = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions/skill-draft` })).json();
    expect(draft.count).toBe(0);

    // accept → present in the draft body
    const accepted = (
      await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { accepted: true } })
    ).json();
    expect(accepted.accepted).toBe(true);

    draft = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions/skill-draft` })).json();
    expect(draft.count).toBe(1);
    expect(draft.name).toBe(`${repo.name}-conventions`);
    expect(draft.body).toContain('Use async/await; never .then() chains.');
    expect(draft.body).toContain('Detected in `src/api/users.ts:5`');

    // bulk reject → draft empty again
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/bulk`, payload: { accepted: false } });
    draft = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions/skill-draft` })).json();
    expect(draft.count).toBe(0);

    await app.close();
  });

  it('extract reads from the local CLONE when the repo is synced (no code_chunks)', async () => {
    const app = await appWith(CANDIDATES_FIXTURE, { 'src/api/users.ts': USERS_FILE });
    // a synced repo: has a clonePath, but NO seeded code_chunks
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'cloned-repo',
        fullName: 'acme/cloned-repo',
        defaultBranch: 'main',
        clonePath: '/mock/clones/acme/cloned-repo',
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verified).toBe(1); // real candidate verified against the clone file
    expect(body.candidates[0].evidence_path).toBe('src/api/users.ts');
    expect(body.candidates[0].evidence_url).toBe(
      'https://github.com/acme/cloned-repo/blob/main/src/api/users.ts#L5',
    );

    await app.close();
  });

  it('extract returns 422 when the repo has no indexed code', async () => {
    const app = await appWith(CANDIDATES_FIXTURE);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'empty-repo', fullName: 'acme/empty-repo' })
      .returning();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
