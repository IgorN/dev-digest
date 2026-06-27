import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

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

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `skills-pr-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('skills module (Testcontainers pg)', () => {
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

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  it('CRUD: create → list → body-edit bumps version, enabled-toggle does not → delete', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'no-console-logs', type: 'convention', body: 'Flag console.log.' },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.version).toBe(1);
    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === skill.id)).toBe(true);

    // body change → version 2
    const edited = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { body: 'Flag console.log and console.error.' },
      })
    ).json();
    expect(edited.version).toBe(2);

    // enabled toggle → no version bump
    const toggled = (
      await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } })
    ).json();
    expect(toggled.version).toBe(2);
    expect(toggled.enabled).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(after.statusCode).toBe(404);

    await app.close();
  });

  it('import: parses a markdown upload into a preview WITHOUT persisting', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const md = `---\nname: imported-rule\ndescription: Does X directively.\ntype: rubric\n---\n\n## Rule\nbody`;
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { filename: 'rule.md', content_base64: Buffer.from(md, 'utf8').toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview.name).toBe('imported-rule');
    expect(preview.type).toBe('rubric');
    expect(preview.source).toBe('community');

    // nothing was persisted by the import call
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { name: string }) => s.name === 'imported-rule')).toBe(false);

    await app.close();
  });

  it('run wiring: an ENABLED linked skill appears as a prompt block; a DISABLED one does not', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skilled Rev', provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
      })
    ).json();

    const onSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'ENABLED-SENTINEL', type: 'custom', body: 'ENABLED_SKILL_MARKER body.' },
      })
    ).json();
    const offSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'DISABLED-SENTINEL',
          type: 'custom',
          body: 'DISABLED_SKILL_MARKER body.',
          enabled: false,
        },
      })
    ).json();

    // link both, in order
    const links = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [onSkill.id, offSkill.id] },
    });
    expect(links.statusCode).toBe(200);
    expect(links.json()).toHaveLength(2);

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toContain('ENABLED_SKILL_MARKER');
    expect(trace.prompt_assembly.skills).not.toContain('DISABLED_SKILL_MARKER');

    const [agentRun] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    expect(agentRun!.status).toBe('done');

    await app.close();
  });

  it('versions: a body edit appends v2; GET /skills/:id/versions returns newest-first', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'versioned-skill', type: 'rubric', body: 'v1 body' },
      })
    ).json();

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'v2 body', version_message: 'Added boundary cases' },
    });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2); // newest first
    expect(versions[0].body).toBe('v2 body');
    expect(versions[0].message).toBe('Added boundary cases'); // version message round-trips
    expect(versions[1].version).toBe(1);
    expect(versions[1].message).toBeNull(); // v1 (creation) has no message

    const unknown = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-0000-0000-000000000000/versions',
    });
    expect(unknown.statusCode).toBe(404);

    await app.close();
  });

  it('usage: GET /skills/:id/usage lists the agents that link the skill', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'usage-skill', type: 'custom', body: 'body' },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Usage Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    // before linking: zero
    let usage = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/usage` })).json();
    expect(usage.agent_count).toBe(0);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    usage = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/usage` })).json();
    expect(usage.agent_count).toBe(1);
    expect(usage.agents[0].name).toBe('Usage Agent');
    expect(usage.agents[0].order).toBe(0);

    await app.close();
  });
});
