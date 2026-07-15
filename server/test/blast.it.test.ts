import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  BlastResult,
  IndexResult,
  IndexState,
  RepoMapResult,
  FileRankRow,
  SymbolRow,
  SignatureRow,
  RefRow,
  RepoIntel,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Minimal RepoIntel double — blast only ever calls getBlastRadius; every
 *  other method throws if hit, so a wiring mistake fails loudly. */
class FakeRepoIntel implements RepoIntel {
  calls: string[] = [];
  constructor(private result: BlastResult) {}
  async indexRepo(): Promise<IndexResult> {
    throw new Error('unexpected: indexRepo');
  }
  async refreshIndex(): Promise<IndexResult> {
    throw new Error('unexpected: refreshIndex');
  }
  async getIndexState(): Promise<IndexState> {
    throw new Error('unexpected: getIndexState');
  }
  async getBlastRadius(): Promise<BlastResult> {
    this.calls.push('getBlastRadius');
    return this.result;
  }
  async getRepoMap(): Promise<RepoMapResult> {
    throw new Error('unexpected: getRepoMap');
  }
  async getFileRank(): Promise<FileRankRow[]> {
    return [];
  }
  async getSymbolsInFiles(): Promise<SymbolRow[]> {
    return [];
  }
  async getCallerSignatures(): Promise<SignatureRow[]> {
    return [];
  }
  async getUnresolvedReferences(): Promise<RefRow[]> {
    return [];
  }
  async getConventionSamples(): Promise<string[]> {
    return [];
  }
  async getTopFilesByRank(): Promise<string[]> {
    return [];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
}

d('blast radius (Testcontainers pg)', () => {
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

  async function appWith(result: BlastResult, summaryText = 'One-paragraph blast summary.') {
    const repoIntel = new FakeRepoIntel(result);
    const llm = new MockLLMProvider('openrouter', { structured: { summary: summaryText } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel, llm: { openrouter: llm } },
    });
    return { app, repoIntel, llm };
  }

  let repoSeq = 0;
  async function setupPr() {
    const name = `blast-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, defaultBranch: 'main' })
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
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pull!.id, path: 'src/lib/rate-limit.ts', additions: 20, deletions: 2 },
    ]);
    return { repo: repo!, pull: pull! };
  }

  const POPULATED_RESULT: BlastResult = {
    changedSymbols: [{ file: 'src/lib/rate-limit.ts', name: 'rateLimit', kind: 'function' }],
    callers: [
      { file: 'src/api/public/items.ts', symbol: 'itemsHandler', viaSymbol: 'rateLimit', line: 23, rank: 0.9 },
      { file: 'src/api/public/webhooks.ts', symbol: 'webhooksHandler', viaSymbol: 'rateLimit', line: 45, rank: 0.6 },
    ],
    impactedEndpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
    factsByFile: {
      'src/api/public/items.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      'src/api/public/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: ['reset-rate-buckets'] },
    },
    degraded: false,
  };

  it('GET before recompute returns null (200, not 404)', async () => {
    const { app } = await appWith(POPULATED_RESULT);
    const { pull } = await setupPr();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pull.id}/blast` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });

  it('recompute shapes the facade result, makes exactly one LLM call, and persists it', async () => {
    const { app, repoIntel, llm } = await appWith(POPULATED_RESULT, 'Rate limiting now guards 2 public endpoints.');
    const { pull } = await setupPr();

    const res = await app.inject({ method: 'POST', url: `/pulls/${pull.id}/blast/recompute`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.changed_symbols).toEqual([{ name: 'rateLimit', file: 'src/lib/rate-limit.ts', kind: 'function' }]);
    expect(body.downstream).toHaveLength(1);
    expect(body.downstream[0].symbol).toBe('rateLimit');
    expect(body.downstream[0].callers).toHaveLength(2);
    expect(body.downstream[0].endpoints_affected.sort()).toEqual(
      ['GET /api/public/items', 'POST /api/public/webhooks'].sort(),
    );
    expect(body.downstream[0].crons_affected).toEqual(['reset-rate-buckets']);
    expect(body.degraded).toBe(false);
    expect(body.degraded_reason).toBeNull();
    expect(body.summary).toBe('Rate limiting now guards 2 public endpoints.');

    expect(repoIntel.calls).toEqual(['getBlastRadius']);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.method).toBe('completeStructured');

    // GET now returns the persisted result, with no further LLM call.
    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pull.id}/blast` });
    expect(getRes.json()).toEqual(body);
    expect(llm.calls).toHaveLength(1);

    await app.close();
  });

  it('zero changed symbols: deterministic summary, zero LLM calls', async () => {
    const empty: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false };
    const { app, llm } = await appWith(empty);
    const { pull } = await setupPr();

    const res = await app.inject({ method: 'POST', url: `/pulls/${pull.id}/blast/recompute`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed_symbols).toEqual([]);
    expect(body.downstream).toEqual([]);
    expect(body.summary).toMatch(/no indexed symbols/i);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('degraded index: response carries degraded:true + reason, endpoints fall back to the flat union', async () => {
    const degradedResult: BlastResult = {
      changedSymbols: [{ file: 'src/lib/rate-limit.ts', name: 'rateLimit', kind: 'function' }],
      callers: [
        { file: 'src/api/public/items.ts', symbol: 'itemsHandler', viaSymbol: 'rateLimit', line: 23, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/public/items'],
      degraded: true,
      reason: 'index_partial',
    };
    const { app } = await appWith(degradedResult);
    const { pull } = await setupPr();

    const res = await app.inject({ method: 'POST', url: `/pulls/${pull.id}/blast/recompute`, payload: {} });
    const body = res.json();
    expect(body.degraded).toBe(true);
    expect(body.degraded_reason).toBe('index_partial');
    expect(body.downstream[0].endpoints_affected).toEqual(['GET /api/public/items']);

    await app.close();
  });

  it('404s on an unknown PR id for both routes', async () => {
    const { app } = await appWith(POPULATED_RESULT);
    const unknownId = '00000000-0000-0000-0000-000000000000';

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/blast` });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe('not_found');

    const postRes = await app.inject({ method: 'POST', url: `/pulls/${unknownId}/blast/recompute`, payload: {} });
    expect(postRes.statusCode).toBe(404);

    await app.close();
  });
});
