import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-persistence] Docker not available — skipping integration tests.');
}

/**
 * T4 — ordered `context_documents` persistence on agents and skills.
 *   (a) POST /agents/:id/context-documents persists paths in order (path
 *       strings, never content) AND snapshots a NEW agent version whose
 *       config carries them (AC-5, D6).
 *   (b) POST /skills/:id/context-documents persists with NO new skill body
 *       version (AC-6, D6 — parallel to evidence_files).
 *   (c) A reorder (same set, new order) persists across reload (AC-9 storage half).
 *   (d) Absolute / `..` / non-markdown paths are rejected with a validation
 *       error at save time (AC-19); repeats are deduped first-occurrence-wins.
 */
d('context_documents persistence (agents + skills)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const agentBody = {
    name: 'Context Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff.',
  };

  const skillBody = {
    name: 'Context Skill',
    type: 'custom' as const,
    body: 'Always check error handling.',
  };

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/agents', payload: agentBody });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/skills', payload: skillBody });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('(a) agent: paths persist in order, as strings, and a NEW version snapshots them', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const paths = ['docs/architecture.md', 'specs/feature.md'];

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().context_documents).toEqual(paths);

    // Reload → persisted in order.
    const reloaded = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(reloaded.json().context_documents).toEqual(paths);

    // Stored value holds PATH STRINGS, not document content (DB-level check).
    const [row] = await pg.handle.db
      .select({ contextDocuments: t.agents.contextDocuments })
      .from(t.agents)
      .where(eq(t.agents.id, agentId));
    expect(row!.contextDocuments).toEqual(paths);

    // A NEW agent_versions row exists (v2) with context_documents in its config (D6).
    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].config.context_documents).toEqual(paths);
    // v1 predates any attachment — the contract defaults it for old snapshots.
    expect(versions[1].config.context_documents).toEqual([]);
    await app.close();
  });

  it('(a2) agent: a no-op set (identical ordered array) does not cut another version', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const paths = ['docs/a.md'];

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths },
    });
    expect(again.statusCode).toBe(200);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions).toHaveLength(2); // v1 (create) + v2 (first attach) only
    await app.close();
  });

  it('(b) skill: paths persist with NO new skill body version', async () => {
    const app = await makeApp();
    const skillId = await createSkill(app);
    const paths = ['docs/rules.md', 'insights/notes.md'];

    const set = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context-documents`,
      payload: { paths },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().context_documents).toEqual(paths);

    const reloaded = await app.inject({ method: 'GET', url: `/skills/${skillId}` });
    expect(reloaded.json().context_documents).toEqual(paths);
    expect(reloaded.json().version).toBe(1); // body version untouched

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })
    ).json();
    expect(versions).toHaveLength(1); // only the v1 create snapshot
    await app.close();
  });

  it('(c) reorder (same set, new order) persists across reload', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const initial = ['docs/a.md', 'docs/b.md', 'specs/c.md'];
    const reordered = ['specs/c.md', 'docs/a.md', 'docs/b.md'];

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths: initial },
    });
    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths: reordered },
    });
    expect(set.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json().context_documents,
    ).toEqual(reordered);

    // Same for a skill.
    const skillId = await createSkill(app);
    await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context-documents`,
      payload: { paths: initial },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context-documents`,
      payload: { paths: reordered },
    });
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${skillId}` })).json().context_documents,
    ).toEqual(reordered);
    await app.close();
  });

  it('(d) unsafe and non-markdown paths are rejected with a validation error', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const skillId = await createSkill(app);

    const bad = [
      ['/etc/passwd.md'], // absolute
      ['../secrets.md'], // parent escape
      ['docs/../../etc/passwd.md'], // embedded ..
      ['docs\\evil.md'], // backslash
      ['docs/readme.txt'], // not markdown
    ];
    for (const paths of bad) {
      const agentRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/context-documents`,
        payload: { paths },
      });
      expect(agentRes.statusCode).toBe(422);
      const skillRes = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/context-documents`,
        payload: { paths },
      });
      expect(skillRes.statusCode).toBe(422);
    }

    // A rejected save leaves the stored set untouched (null — never attached).
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json().context_documents,
    ).toBeNull();
    await app.close();
  });

  it('(d2) repeated paths are deduped preserving first occurrence', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-documents`,
      payload: { paths: ['docs/a.md', 'docs/b.md', 'docs/a.md'] },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().context_documents).toEqual(['docs/a.md', 'docs/b.md']);
    await app.close();
  });
});
