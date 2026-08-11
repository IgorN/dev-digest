/**
 * Project Context reader (T3) — GET /repos/:id/context (+ /context/document):
 *   - inventory lists .md files under configured roots (any depth) with path +
 *     root badge, excluding non-configured folders and non-markdown (AC-1/AC-3),
 *   - the seeded no-clone repo (acme/payments-api, clonePath null) returns a
 *     200 empty has_clone:false envelope, never 5xx (AC-4),
 *   - EVERY app here wires an always-throwing LLM double via
 *     ContainerOverrides.llm — 200 responses are the concrete zero-model-call
 *     proof (AC-15; asserting by control flow, not grep),
 *   - a crafted ../../etc/passwd preview is refused with no outside read, and a
 *     REAL-fs tracked symlink pointing outside the clone is refused by the git
 *     adapter's realpath containment — 404 preview, token_estimate 0 (AC-19),
 *   - a non-default CONTEXT_ROOTS config drives the root filter (AC-3),
 *   - lookups are workspace-scoped (foreign-workspace repo → 404).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { approxTokens, truncateToBytes } from '../src/modules/context/helpers.js';
import * as t from '../src/db/schema.js';
import { ContextInventory, type LLMProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

const config = (extraEnv: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...extraEnv } as NodeJS.ProcessEnv);

/** Every method throws — injected for all apps so any LLM call fails the test. */
function throwingLlmProvider(id: 'openai' | 'anthropic' | 'openrouter'): LLMProvider {
  const boom = (): never => {
    throw new Error(`project-context must never call the ${id} LLM provider`);
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
  openai: throwingLlmProvider('openai'),
  anthropic: throwingLlmProvider('anthropic'),
  openrouter: throwingLlmProvider('openrouter'),
};

const CLONE_FILES: Record<string, string> = {
  'docs/intro.md': '# Intro\n\nGetting started.',
  'specs/2026/context-folder.md': '# Spec\n\nProject context folder.',
  'server/insights/notes.md': '# Notes',
  'random/notes.md': '# Not a context doc', // non-configured folder → excluded
  'docs/diagram.ts': 'export const x = 1;', // not markdown → excluded
  'README.md': '# Root readme', // markdown but not under a root → excluded
};

d('project context reader (Testcontainers pg)', () => {
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

  function appWith(gitFiles?: Record<string, string>, extraEnv: Record<string, string> = {}) {
    return buildApp({
      config: config(extraEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(gitFiles ? { files: gitFiles } : {}),
        llm: NO_LLM,
      },
    });
  }

  let repoSeq = 0;
  async function setupClonedRepo(wsId = workspaceId) {
    const name = `ctx-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: wsId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        clonePath: `/mock/clones/acme/${name}`,
      })
      .returning();
    return repo!;
  }

  it('inventory lists .md under configured roots with root badges, excludes the rest (AC-1, AC-3)', async () => {
    const app = await appWith(CLONE_FILES);
    const repo = await setupClonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = ContextInventory.parse(res.json());

    expect(body.repo_id).toBe(repo.id);
    expect(body.has_clone).toBe(true);
    expect(body.count).toBe(3);
    expect(body.items.map((i) => ({ path: i.path, root: i.root }))).toEqual([
      { path: 'docs/intro.md', root: 'docs' },
      { path: 'server/insights/notes.md', root: 'insights' },
      { path: 'specs/2026/context-folder.md', root: 'specs' },
    ]);
    // excluded: non-configured folder, non-markdown, root-level README
    const paths = body.items.map((i) => i.path);
    expect(paths).not.toContain('random/notes.md');
    expect(paths).not.toContain('docs/diagram.ts');
    expect(paths).not.toContain('README.md');

    // deterministic estimator over current content: ceil(len/4), never 0 here
    const intro = body.items.find((i) => i.path === 'docs/intro.md')!;
    expect(intro.token_estimate).toBe(Math.ceil(CLONE_FILES['docs/intro.md']!.length / 4));

    await app.close();
  });

  it('seeded no-clone repo (acme/payments-api) → 200 empty has_clone:false, not 5xx (AC-4)', async () => {
    const app = await appWith();
    const [demo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    expect(demo!.clonePath).toBeNull();

    const res = await app.inject({ method: 'GET', url: `/repos/${demo!.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = ContextInventory.parse(res.json());
    expect(body).toEqual({ repo_id: demo!.id, has_clone: false, count: 0, items: [] });

    await app.close();
  });

  it('inventory + preview return 200 with an always-throwing LLM double wired in (AC-15)', async () => {
    const app = await appWith(CLONE_FILES);
    const repo = await setupClonedRepo();

    const inv = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(inv.statusCode).toBe(200);

    const prev = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/document?path=${encodeURIComponent('docs/intro.md')}`,
    });
    expect(prev.statusCode).toBe(200);
    const doc = prev.json();
    expect(doc.path).toBe('docs/intro.md');
    expect(doc.root).toBe('docs');
    expect(doc.content).toBe(CLONE_FILES['docs/intro.md']);
    expect(doc.truncated).toBe(false);
    expect(doc.token_estimate).toBe(Math.ceil(CLONE_FILES['docs/intro.md']!.length / 4));

    await app.close();
  });

  it('refuses a traversal preview path — no file outside the clone is read (AC-19)', async () => {
    const app = await appWith(CLONE_FILES);
    const repo = await setupClonedRepo();

    for (const bad of ['../../etc/passwd', '/etc/passwd', 'docs/../../etc/passwd.md']) {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/document?path=${encodeURIComponent(bad)}`,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      expect(res.body).not.toContain('root:'); // no /etc/passwd content leaked
    }

    // safe-looking but outside the configured roots → also refused
    const outside = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/document?path=${encodeURIComponent('random/notes.md')}`,
    });
    expect(outside.statusCode).toBe(422);

    await app.close();
  });

  it('inventory token_estimate is capped at CONTEXT_DOC_MAX_BYTES, matching injection truncation', async () => {
    const cap = 256;
    const big = '# Big\n' + 'y'.repeat(5000);
    const app = await appWith({ 'docs/big.md': big }, { CONTEXT_DOC_MAX_BYTES: String(cap) });
    const repo = await setupClonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const item = ContextInventory.parse(res.json()).items.find((i) => i.path === 'docs/big.md')!;

    // same number a run would inject: tokens over the cap-truncated content
    expect(item.token_estimate).toBe(approxTokens(truncateToBytes(big, cap).text.length));
    expect(item.token_estimate).toBeLessThan(approxTokens(big.length));

    await app.close();
  });

  it('inventory honors a NON-default CONTEXT_ROOTS config (AC-3)', async () => {
    // With roots overridden to specs,adr: adr/ docs appear, docs/ ones do not.
    const files: Record<string, string> = {
      'adr/0001-choose-postgres.md': '# ADR 1\n\nUse Postgres.',
      'specs/feature.md': '# Spec',
      'docs/intro.md': '# Intro', // configured by DEFAULT but not in this app
      'insights/notes.md': '# Notes', // ditto
    };
    const app = await appWith(files, { CONTEXT_ROOTS: 'specs,adr' });
    const repo = await setupClonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = ContextInventory.parse(res.json());

    expect(body.items.map((i) => ({ path: i.path, root: i.root }))).toEqual([
      { path: 'adr/0001-choose-postgres.md', root: 'adr' },
      { path: 'specs/feature.md', root: 'specs' },
    ]);
    const paths = body.items.map((i) => i.path);
    expect(paths).not.toContain('docs/intro.md');
    expect(paths).not.toContain('insights/notes.md');

    // and a default-root doc can't be previewed under the overridden config
    const prev = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/document?path=${encodeURIComponent('docs/intro.md')}`,
    });
    expect(prev.statusCode).toBe(422);

    await app.close();
  });

  it('a tracked symlink escaping the clone is refused — 404 preview, estimate 0 (AC-19)', async () => {
    // REAL fs + the REAL SimpleGitClient.readFile (the realpath containment
    // under test). Only listFiles is stubbed to the "tracked" set, standing in
    // for `git ls-files` so the fixture needs no git init/commit.
    class RealFsGitClient extends SimpleGitClient {
      constructor(
        cloneDir: string,
        private tracked: string[],
      ) {
        super(cloneDir);
      }
      override async listFiles(): Promise<string[]> {
        return this.tracked;
      }
    }

    const base = await mkdtemp(join(tmpdir(), 'ctx-symlink-'));
    try {
      const cloneDir = join(base, 'clones');
      const secretPath = join(base, 'outside-secret.md');
      await writeFile(secretPath, 'TOP-SECRET outside the clone');

      // clonePath on the row only gates the has_clone check; the adapter
      // derives the on-disk location from its cloneDir + owner/name.
      const repo = await setupClonedRepo();
      const cloneRoot = join(cloneDir, 'acme', repo.name);
      await mkdir(join(cloneRoot, 'docs'), { recursive: true });
      await writeFile(join(cloneRoot, 'docs', 'real.md'), '# Real doc');
      // absolute-target escape + relative ../ escape, both inside the clone
      await symlink(secretPath, join(cloneRoot, 'docs', 'leak.md'));
      await symlink(
        join('..', '..', '..', '..', 'outside-secret.md'),
        join(cloneRoot, 'docs', 'leak-rel.md'),
      );

      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          git: new RealFsGitClient(cloneDir, ['docs/real.md', 'docs/leak.md', 'docs/leak-rel.md']),
          llm: NO_LLM,
        },
      });

      // (a) previewing either symlink is a clean 4xx — never the target's content
      for (const leak of ['docs/leak.md', 'docs/leak-rel.md']) {
        const prev = await app.inject({
          method: 'GET',
          url: `/repos/${repo.id}/context/document?path=${encodeURIComponent(leak)}`,
        });
        expect(prev.statusCode).toBe(404);
        expect(prev.body).not.toContain('TOP-SECRET');
      }

      // ...while a genuine file previews fine through the same real-fs adapter
      const ok = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/document?path=${encodeURIComponent('docs/real.md')}`,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().content).toBe('# Real doc');

      // (b) inventory stays 200; the escapes read as token_estimate 0
      const inv = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      expect(inv.statusCode).toBe(200);
      const body = ContextInventory.parse(inv.json());
      const byPath = new Map(body.items.map((i) => [i.path, i]));
      expect(byPath.get('docs/leak.md')!.token_estimate).toBe(0);
      expect(byPath.get('docs/leak-rel.md')!.token_estimate).toBe(0);
      expect(byPath.get('docs/real.md')!.token_estimate).toBeGreaterThan(0);

      // (c) run-time: the executor treats the same adapter throw as
      // skipped_missing — covered by reviews-context.it.test.ts (ENOENT path
      // through the identical catch), so no heavyweight run fixture here.

      await app.close();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('a repo from a different workspace 404s (workspace-scoped lookup)', async () => {
    const app = await appWith(CLONE_FILES);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `ctx-other-${Date.now()}` })
      .returning();
    const foreign = await setupClonedRepo(otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/repos/${foreign.id}/context` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
