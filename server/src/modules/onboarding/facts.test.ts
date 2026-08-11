import { describe, it, expect } from 'vitest';
import { gatherFacts } from './facts.js';
import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../../db/rows.js';
import type {
  FileRankRow,
  IndexState,
  RepoMapResult,
  SymbolRow,
} from '../repo-intel/types.js';

/**
 * T3 — zero-LLM facts analyzer. Proves the bundle builds against a MOCKED
 * `container.repoIntel` / `container.git` with (i) full data → populated bundle
 * whose reading-path is sorted by DESCENDING rank (AC-6), (ii) no-clone /
 * degraded → partial bundle with a degraded marker + a non-empty allow-list
 * where facts exist (AC-9, AC-11), and never throws. No Postgres, no clone.
 */

interface RepoIntelStub {
  getIndexState?: (repoId: string) => Promise<IndexState>;
  getRepoMap?: (repoId: string) => Promise<RepoMapResult>;
  getTopFilesByRank?: (repoId: string, n: number, opts?: { exclude?: string[] }) => Promise<string[]>;
  getFileRank?: (repoId: string, paths: string[]) => Promise<FileRankRow[]>;
  getCriticalPaths?: (repoId: string) => Promise<string[][]>;
  getSymbolsInFiles?: (repoId: string, paths: string[]) => Promise<SymbolRow[]>;
}

interface GitStub {
  readFile?: (repo: RepoRow, path: string) => Promise<string>;
  listFiles?: (repo: RepoRow) => Promise<string[]>;
}

function makeContainer(repoIntel: RepoIntelStub, git: GitStub): Container {
  return { repoIntel, git } as unknown as Container;
}

function makeRepo(overrides: Partial<RepoRow> = {}): RepoRow {
  return { id: 'r1', owner: 'acme', name: 'widget', clonePath: '/tmp/clone', ...overrides } as RepoRow;
}

function fullIndexState(filesIndexed = 42): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed,
    filesSkipped: 0,
    durationMs: 10,
    lastIndexedSha: 'abc',
    indexerVersion: 1,
    updatedAt: new Date(),
  };
}

describe('gatherFacts — full data', () => {
  it('builds a populated bundle with the reading-path sorted by DESCENDING rank (AC-6)', async () => {
    const container = makeContainer(
      {
        getIndexState: async () => fullIndexState(42),
        getRepoMap: async () => ({ text: 'repo map', tokens: 3, cached: false }),
        // Returned already rank-ordered by the facade; we re-sort on percentiles.
        getTopFilesByRank: async () => ['a.ts', 'b.ts', 'c.ts'],
        // Percentiles intentionally OUT OF the input order to prove we sort.
        getFileRank: async () => [
          { path: 'a.ts', percentile: 0.2 },
          { path: 'b.ts', percentile: 0.9 },
          { path: 'c.ts', percentile: 0.5 },
        ],
        getCriticalPaths: async () => [['a.ts', 'b.ts']],
        getSymbolsInFiles: async () => [
          { file: 'b.ts', name: 'doThing', kind: 'function', exported: true, startLine: 1, endLine: 9, signature: null },
        ],
      },
      {
        readFile: async (_repo, path) => {
          if (path === 'package.json') {
            return JSON.stringify({
              name: 'widget',
              scripts: { dev: 'tsx watch', test: 'vitest' },
              dependencies: { next: '15', fastify: '4' },
              devDependencies: { vitest: '1' },
            });
          }
          throw new Error('ENOENT');
        },
        listFiles: async () => ['a.ts', 'b.ts', 'c.ts', '.env.example', 'docker-compose.yml', 'package.json'],
      },
    );

    const bundle = await gatherFacts(container, makeRepo());

    // Index state: full, not degraded, real files-indexed count.
    expect(bundle.indexState.status).toBe('full');
    expect(bundle.indexState.degraded).toBe(false);
    expect(bundle.indexState.filesIndexed).toBe(42);
    expect(bundle.hasClone).toBe(true);

    // Reading-path sorted by DESCENDING rank — b (0.9) > c (0.5) > a (0.2).
    expect(bundle.readingPath.map((e) => e.path)).toEqual(['b.ts', 'c.ts', 'a.ts']);
    expect(bundle.readingPath[0]!.rank).toBe(0.9);

    // Stack detected deterministically from the manifest deps.
    expect(bundle.stack.packageName).toBe('widget');
    expect(bundle.stack.frameworks).toEqual(expect.arrayContaining(['Next.js', 'Fastify', 'Vitest']));

    // Scripts enumerated; run-locally signals detected.
    expect(bundle.runLocally.scripts).toEqual([
      { name: 'dev', command: 'tsx watch' },
      { name: 'test', command: 'vitest' },
    ]);
    expect(bundle.runLocally.hasEnvExample).toBe(true);
    expect(bundle.runLocally.hasDockerCompose).toBe(true);
    expect(bundle.runLocally.hasSignals).toBe(true);

    // Critical paths + first-task symbols carried through.
    expect(bundle.criticalPaths).toEqual([['a.ts', 'b.ts']]);
    expect(bundle.topSymbols).toEqual([{ file: 'b.ts', name: 'doThing', kind: 'function' }]);

    // Allow-list unions every real path seen (AC-9 fuel).
    for (const p of ['a.ts', 'b.ts', 'c.ts', '.env.example', 'docker-compose.yml', 'package.json']) {
      expect(bundle.allowedPaths.has(p)).toBe(true);
    }
    // A path never seen is NOT allowed.
    expect(bundle.allowedPaths.has('invented.ts')).toBe(false);
  });
});

describe('gatherFacts — degraded / no-clone (AC-11)', () => {
  it('no-clone repo → partial bundle with a degraded marker, never throws, no clone reads', async () => {
    let cloneReads = 0;
    const container = makeContainer(
      {
        // getIndexState still works; here it reports full, but no clone forces degraded.
        getIndexState: async () => fullIndexState(0),
        getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
        getTopFilesByRank: async () => [],
        getFileRank: async () => [],
        getCriticalPaths: async () => [],
        getSymbolsInFiles: async () => [],
      },
      {
        readFile: async () => {
          cloneReads += 1;
          throw new Error('should not be called');
        },
        listFiles: async () => {
          cloneReads += 1;
          throw new Error('should not be called');
        },
      },
    );

    const bundle = await gatherFacts(container, makeRepo({ clonePath: null }));

    expect(bundle.hasClone).toBe(false);
    expect(bundle.indexState.degraded).toBe(true);
    expect(bundle.indexState.status).toBe('degraded');
    expect(bundle.indexState.reason).toBe('no local clone');
    // No clone → no git reads attempted at all.
    expect(cloneReads).toBe(0);
    // Empty facts everywhere, but a valid (non-throwing) bundle.
    expect(bundle.readingPath).toEqual([]);
    expect(bundle.criticalPaths).toEqual([]);
    expect(bundle.stack.frameworks).toEqual([]);
    expect(bundle.allowedPaths.size).toBe(0);
  });

  it('degraded index WITH facts → degraded marker AND a non-empty allow-list', async () => {
    const container = makeContainer(
      {
        getIndexState: async () => ({ ...fullIndexState(7), status: 'partial', degraded: true, reason: 'index_partial' }),
        getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
        getTopFilesByRank: async () => ['core.ts'],
        getFileRank: async () => [{ path: 'core.ts', percentile: 0.4 }],
        getCriticalPaths: async () => [],
        getSymbolsInFiles: async () => [],
      },
      {
        // No package.json in this reduced repo.
        readFile: async () => {
          throw new Error('ENOENT');
        },
        listFiles: async () => ['core.ts'],
      },
    );

    const bundle = await gatherFacts(container, makeRepo());

    expect(bundle.indexState.degraded).toBe(true);
    expect(bundle.indexState.status).toBe('degraded');
    // A facts-bearing path still lands in the allow-list.
    expect(bundle.readingPath.map((e) => e.path)).toEqual(['core.ts']);
    expect(bundle.allowedPaths.has('core.ts')).toBe(true);
    expect(bundle.allowedPaths.size).toBeGreaterThan(0);
    // No manifest → no fabricated stack.
    expect(bundle.stack.packageName).toBeNull();
    expect(bundle.stack.frameworks).toEqual([]);
    expect(bundle.runLocally.hasSignals).toBe(false);
  });

  it('never throws even when every repo-intel method AND every clone read throws', async () => {
    const boom = async () => {
      throw new Error('boom');
    };
    const container = makeContainer(
      {
        getIndexState: boom,
        getRepoMap: boom,
        getTopFilesByRank: boom,
        getFileRank: boom,
        getCriticalPaths: boom,
        getSymbolsInFiles: boom,
      },
      { readFile: boom, listFiles: boom },
    );

    const bundle = await gatherFacts(container, makeRepo());

    // Fully degraded, but a valid bundle — the promise resolved, never rejected.
    expect(bundle.indexState.degraded).toBe(true);
    expect(bundle.readingPath).toEqual([]);
    expect(bundle.criticalPaths).toEqual([]);
    expect(bundle.allowedPaths.size).toBe(0);
  });
});
