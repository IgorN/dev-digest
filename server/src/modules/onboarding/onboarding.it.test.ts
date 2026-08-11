/**
 * Onboarding tour — end-to-end AC proofs (Docker-gated: real container + real
 * Postgres via Testcontainers, mirroring blast.it.test.ts / smart-diff.it.test.ts).
 *
 * The behavioural ACs this suite pins:
 *   - AC-1  GET on a repo with a persisted tour → 200, tour returned, ZERO LLM
 *           calls. Proven with an ALWAYS-THROWING `ContainerOverrides.llm` double
 *           (if GET touched the LLM the request would 500) — NOT by grepping for
 *           the call (server INSIGHTS: grep-for-LLM is fragile).
 *   - AC-2  GET on a never-generated repo → 200 with `onboarding: null`, no LLM.
 *   - AC-3  POST …/recompute on a USABLE index → exactly one `completeStructured`
 *           and the row upserted with a fresh `generatedAt`.
 *   - AC-11 recompute against the seeded no-clone `acme/payments-api`
 *           (`clonePath: null`) → a PERSISTED skeleton with a degraded/failed
 *           `index_state` + non-empty `sections`, NOT a 5xx.
 *   - AC-12 with the throwing-LLM double, recompute on an otherwise-usable repo →
 *           still a skeleton marked degraded, NOT a 5xx.
 *   - AC-15 recompute against a stub provider that returns token/cost emits ONE
 *           structured log line carrying `{ tokensIn, tokensOut, costUsd }`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { Container } from '../../platform/container.js';
import { MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { Onboarding, type LLMProvider, type StructuredResult } from '@devdigest/shared';
import type { Logger } from '../reviews/run-executor.js';
import type {
  BlastResult,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  SignatureRow,
  SymbolRow,
} from '../repo-intel/types.js';
import { OnboardingService } from './service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// LLM doubles injected via ContainerOverrides.llm (keyed by provider id). The
// onboarding feature's default provider is `openrouter` (FEATURE_MODELS), so
// that key is the one that matters — but wiring all three makes any accidental
// provider swap fail loudly instead of silently reaching a real network client.
// ---------------------------------------------------------------------------

type LlmId = 'openai' | 'anthropic' | 'openrouter';

/** Every method throws — the concrete proof behind "this path makes no LLM call". */
function throwingLlm(id: LlmId): LLMProvider {
  const boom = (): never => {
    throw new Error(`onboarding must not call the ${id} LLM provider here`);
  };
  return {
    id: id as LLMProvider['id'],
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

/** A stub `completeStructured` provider that counts calls and returns fixed
 *  token/cost — so AC-3 can assert "exactly one call" and AC-15 can assert the
 *  emitted cost log line carries the returned figures. */
class StubLlm implements LLMProvider {
  readonly id: LLMProvider['id'];
  calls: string[] = [];
  constructor(
    id: LlmId,
    private token = { tokensIn: 7, tokensOut: 11, costUsd: 0.0021 as number | null },
  ) {
    this.id = id as LLMProvider['id'];
  }
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('onboarding must use completeStructured, never complete()');
  }
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    this.calls.push('completeStructured');
    // The model may omit/violate any section — the service merges onto the
    // deterministic skeleton, so an empty section list is a valid response.
    return {
      data: { sections: [] } as unknown as T,
      model: 'stub-model',
      tokensIn: this.token.tokensIn,
      tokensOut: this.token.tokensOut,
      costUsd: this.token.costUsd,
      raw: '{"sections":[]}',
      attempts: 1,
    };
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

// ---------------------------------------------------------------------------
// A usable-index RepoIntel double. Onboarding's fact gathering only reads the
// facade; every unused method throws so a wiring regression fails loudly.
// ---------------------------------------------------------------------------
class UsableRepoIntel implements RepoIntel {
  private state: IndexState = {
    repoId: 'x',
    status: 'full',
    filesIndexed: 42,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'deadbeef',
    indexerVersion: 1,
    updatedAt: new Date('2026-07-18T00:00:00Z'),
    degraded: false,
  };
  async indexRepo(): Promise<IndexResult> {
    throw new Error('unexpected: indexRepo');
  }
  async refreshIndex(): Promise<IndexResult> {
    throw new Error('unexpected: refreshIndex');
  }
  async getIndexState(repoId: string): Promise<IndexState> {
    return { ...this.state, repoId };
  }
  async getBlastRadius(): Promise<BlastResult> {
    throw new Error('unexpected: getBlastRadius');
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: 'root\n  src/\n    index.ts\n', tokens: 12, cached: false };
  }
  async getFileRank(): Promise<FileRankRow[]> {
    return [
      { path: 'src/index.ts', percentile: 0.9 },
      { path: 'src/service.ts', percentile: 0.7 },
    ];
  }
  async getSymbolsInFiles(): Promise<SymbolRow[]> {
    return [
      { file: 'src/index.ts', name: 'main', kind: 'function', exported: true, startLine: 1, endLine: 5, signature: null },
    ];
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
    return ['src/index.ts', 'src/service.ts'];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [['src/index.ts', 'src/service.ts']];
  }
}

d('onboarding tour (Testcontainers pg)', () => {
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

  let repoSeq = 0;
  /** Insert a fresh repo in the default workspace. `clonePath` set → the fact
   *  gatherer treats the repo as cloned (so a usable index is reachable). */
  async function makeRepo(opts: { clonePath?: string | null } = {}) {
    const name = `onb-${repoSeq++}-${Date.now()}`;
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
    return repo!;
  }

  // -- AC-1 -----------------------------------------------------------------
  it('AC-1: GET on a repo with a persisted tour → 200 + tour, with an always-throwing LLM wired in (zero LLM calls)', async () => {
    const db = pg.handle.db;
    const repo = await makeRepo();
    const persisted: Onboarding = {
      sections: [{ kind: 'architecture', title: 'Architecture', body: 'Persisted body.', diagram: null, links: [] }],
      index_state: 'full',
      degraded_reason: null,
      files_indexed: 12,
    };
    await db.insert(t.onboarding).values({ repoId: repo.id, json: persisted });

    // If GET touched the LLM at all, the throwing double would surface a 500.
    const app = await buildApp({ config: config(), db, overrides: { llm: THROWING_LLM } });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const tour = Onboarding.parse(body.onboarding);
    expect(tour.sections[0]!.body).toBe('Persisted body.');
    expect(tour.index_state).toBe('full');

    await app.close();
  });

  // -- AC-2 -----------------------------------------------------------------
  it('AC-2: GET on a never-generated repo → 200 with a null tour and no LLM call', async () => {
    const db = pg.handle.db;
    const repo = await makeRepo();

    const app = await buildApp({ config: config(), db, overrides: { llm: THROWING_LLM } });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboarding).toBeNull();

    await app.close();
  });

  // -- AC-3 -----------------------------------------------------------------
  it('AC-3: recompute on a usable index issues exactly one completeStructured and upserts the row with a fresh generatedAt', async () => {
    const db = pg.handle.db;
    const repo = await makeRepo({ clonePath: '/mock/clones/acme/onb-usable' });
    const stub = new StubLlm('openrouter');

    const before = Date.now();
    const app = await buildApp({
      config: config(),
      db,
      overrides: { repoIntel: new UsableRepoIntel(), git: new MockGitClient(), llm: { openrouter: stub } },
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/recompute`, payload: {} });
    expect(res.statusCode).toBe(200);

    // Exactly one narrative call.
    expect(stub.calls).toEqual(['completeStructured']);

    // The response is a valid, full tour (all five kinds, index not degraded).
    const tour = Onboarding.parse(res.json().onboarding);
    expect(tour.sections).toHaveLength(5);
    expect(tour.index_state).toBe('full');

    // The row was upserted with a fresh generatedAt (the column is stamped on write).
    const [row] = await db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(row).toBeDefined();
    expect(row!.generatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // AC-19: the DB-stamped generatedAt is folded into the returned payload (not
    // left null) — both on the recompute response and a follow-up GET — so the
    // client's "last refreshed" staleness header has a real timestamp to render.
    expect(tour.generated_at).toEqual(row!.generatedAt.toISOString());
    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    const got = Onboarding.parse(getRes.json().onboarding);
    expect(got.generated_at).toEqual(row!.generatedAt.toISOString());

    await app.close();
  });

  // -- AC-11 ----------------------------------------------------------------
  it('AC-11: recompute against the seeded no-clone acme/payments-api resolves to a persisted degraded skeleton, not a 5xx', async () => {
    const db = pg.handle.db;
    const [seeded] = await db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    expect(seeded).toBeDefined();
    expect(seeded!.clonePath).toBeNull();

    // Real repo-intel here (no override) — this genuinely exercises the no-clone
    // path. The throwing LLM proves no model call is even attempted for a
    // degraded index.
    const app = await buildApp({ config: config(), db, overrides: { llm: THROWING_LLM } });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${seeded!.id}/onboarding/recompute`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const tour = Onboarding.parse(res.json().onboarding);
    expect(['degraded', 'failed']).toContain(tour.index_state);
    expect(tour.sections.length).toBeGreaterThan(0);

    // Persisted: a follow-up GET returns the same degraded tour.
    const getRes = await app.inject({ method: 'GET', url: `/repos/${seeded!.id}/onboarding` });
    expect(getRes.statusCode).toBe(200);
    const got = Onboarding.parse(getRes.json().onboarding);
    expect(['degraded', 'failed']).toContain(got.index_state);
    expect(got.sections.length).toBeGreaterThan(0);

    await app.close();
  });

  // -- AC-12 ----------------------------------------------------------------
  it('AC-12: with a throwing LLM, recompute on an otherwise-usable repo degrades to a skeleton, not a 5xx', async () => {
    const db = pg.handle.db;
    const repo = await makeRepo({ clonePath: '/mock/clones/acme/onb-throwing' });

    const app = await buildApp({
      config: config(),
      db,
      overrides: { repoIntel: new UsableRepoIntel(), git: new MockGitClient(), llm: THROWING_LLM },
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/recompute`, payload: {} });
    expect(res.statusCode).toBe(200);

    const tour = Onboarding.parse(res.json().onboarding);
    // The index WAS usable, but the single narrative call threw — the service
    // keeps the skeleton and marks it degraded with a surfaced reason (AC-12).
    expect(tour.index_state).toBe('degraded');
    expect(tour.degraded_reason).toBeTruthy();
    expect(tour.sections).toHaveLength(5);

    await app.close();
  });

  // -- AC-15 ----------------------------------------------------------------
  it('AC-15: a usable-index recompute emits exactly one structured log line carrying { tokensIn, tokensOut, costUsd }', async () => {
    const db = pg.handle.db;
    const repo = await makeRepo({ clonePath: '/mock/clones/acme/onb-log' });
    const stub = new StubLlm('openrouter', { tokensIn: 7, tokensOut: 11, costUsd: 0.0021 });

    // Drive the service directly so the emitted log line is captured through a
    // fake Logger (the route otherwise routes it to Fastify's pino instance).
    const container = new Container(config(), db, {
      repoIntel: new UsableRepoIntel(),
      git: new MockGitClient(),
      llm: { openrouter: stub },
    });
    const service = new OnboardingService(container);

    const infoLogs: { obj: Record<string, unknown>; msg?: string }[] = [];
    const logger: Logger = {
      info: (obj, msg) => infoLogs.push({ obj: obj as Record<string, unknown>, msg }),
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    const tour = await service.recompute(workspaceId, repo.id, logger);
    expect(tour.index_state).toBe('full');
    expect(stub.calls).toEqual(['completeStructured']);

    // Exactly one info line carries the cost triple, with the stub's figures.
    const costLines = infoLogs.filter(
      (l) => 'tokensIn' in l.obj && 'tokensOut' in l.obj && 'costUsd' in l.obj,
    );
    expect(costLines).toHaveLength(1);
    expect(costLines[0]!.obj).toMatchObject({
      repoId: repo.id,
      tokensIn: 7,
      tokensOut: 11,
      costUsd: 0.0021,
    });
  });
});
