/**
 * Onboarding facts — zero-LLM analyzer (onion application ring; does I/O via
 * `container.repoIntel` + `container.git` ONLY, never a model).
 *
 * `gatherFacts` turns the already-built repo-intel index plus the local clone
 * into an INTERNAL `FactsBundle` — server-only data, never a wire contract.
 * T4's `skeleton.ts` consumes it to build the deterministic 5-section
 * `Onboarding` payload; the single LLM call only enriches that skeleton.
 *
 * DEGRADE, NEVER THROW (AC-11): no clone (`clonePath === null`), a degraded or
 * absent index, empty arrays, or an unreadable manifest all resolve to a PARTIAL
 * bundle with honest markers — this function never rejects. Every real path it
 * observes is collected into `allowedPaths`, the AC-9 link filter's fuel. It
 * makes ZERO LLM calls (AC-5); the only touchpoints are the repo-intel facade
 * and the git clone reader.
 */
import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../../db/rows.js';
import type { FileRankRow, IndexState, RepoMapResult, SymbolRow } from '../repo-intel/types.js';
import {
  buildAllowedPaths,
  detectRunLocally,
  detectStack,
  enumerateScripts,
  parsePackageJson,
  resolveIndexState,
  sortReadingPathByRank,
  toSymbolFacts,
  type FactsIndexState,
  type ReadingPathEntry,
  type RunLocallyFacts,
  type StackFacts,
  type SymbolFact,
} from './helpers.js';
import { FIRST_TASK_FILE_LIMIT, PACKAGE_JSON_PATH, READING_PATH_EXCLUDE, READING_PATH_LIMIT } from './constants.js';

/**
 * The deterministic, server-internal facts a tour is built from. Not a shared
 * contract — only the `Onboarding` payload crosses the wire (Rec-3).
 */
export interface FactsBundle {
  repoId: string;
  /** False when the repo has no local clone on disk (`clonePath === null`). */
  hasClone: boolean;
  /** Effective index state, folding the no-clone case into the degraded contract. */
  indexState: FactsIndexState;
  /** Deterministic stack detected from the manifest (empty when non-Node/absent). */
  stack: StackFacts;
  /** repo-intel repo-map skeleton text; `''` when degraded. */
  repoMap: string;
  /** Dependency chains from the highest-ranked roots. */
  criticalPaths: string[][];
  /** Node scripts + env/compose signals for the run-locally section (D1). */
  runLocally: RunLocallyFacts;
  /** Files ordered by DESCENDING file rank (AC-6). */
  readingPath: ReadingPathEntry[];
  /** Symbols from the top-ranked files, seeding first-tasks (AC-10). */
  topSymbols: SymbolFact[];
  /** Every real repo-relative path referenced by any fact (AC-9 allow-list). */
  allowedPaths: Set<string>;
}

/**
 * Gather all tour facts for a repo, exclusively from `container.repoIntel` and
 * the local clone — zero LLM (AC-5). Never throws (AC-11).
 */
export async function gatherFacts(container: Container, repo: RepoRow): Promise<FactsBundle> {
  const repoId = repo.id;
  const hasClone = Boolean(repo.clonePath);

  // (a) Index state — the facade contract guarantees this resolves; still
  //     guarded so a surprise throw can never bubble out of fact gathering.
  const rawState = await safe<IndexState | null>(() => container.repoIntel.getIndexState(repoId), null);
  const indexState = resolveIndexState(rawState, hasClone);

  // (b) + (c) Stack + package scripts from the root manifest (best-effort clone read).
  const manifestRaw = hasClone ? await safeReadFile(container, repo, PACKAGE_JSON_PATH) : null;
  const pkg = parsePackageJson(manifestRaw);
  const stack = detectStack(pkg);
  const scripts = enumerateScripts(pkg);

  // (d) run-locally facts (D1): scripts + `.env.example` + `docker-compose*`.
  const trackedFiles = hasClone ? await safeListFiles(container, repo) : [];
  const runLocally = detectRunLocally(trackedFiles, scripts);

  // (b) Structure: repo-map skeleton text ('' when degraded).
  const repoMapResult = await safe<RepoMapResult | null>(() => container.repoIntel.getRepoMap(repoId), null);
  const repoMap = repoMapResult?.text ?? '';

  // (e) Reading-path ORDERED BY DESCENDING rank (AC-6): top files + their ranks.
  const topFiles = await safe<string[]>(
    () => container.repoIntel.getTopFilesByRank(repoId, READING_PATH_LIMIT, { exclude: READING_PATH_EXCLUDE }),
    [],
  );
  const ranks =
    topFiles.length > 0
      ? await safe<FileRankRow[]>(() => container.repoIntel.getFileRank(repoId, topFiles), [])
      : [];
  const readingPath = sortReadingPathByRank(topFiles, ranks);

  // (f) Critical paths.
  const criticalPaths = await safe<string[][]>(() => container.repoIntel.getCriticalPaths(repoId), []);

  // (g) Symbols from the top-ranked files, seeding first-tasks (AC-10).
  const firstTaskFiles = readingPath.slice(0, FIRST_TASK_FILE_LIMIT).map((entry) => entry.path);
  const symbolRows =
    firstTaskFiles.length > 0
      ? await safe<SymbolRow[]>(() => container.repoIntel.getSymbolsInFiles(repoId, firstTaskFiles), [])
      : [];
  const topSymbols = toSymbolFacts(symbolRows);

  const allowedPaths = buildAllowedPaths({
    readingPath,
    criticalPaths,
    symbols: topSymbols,
    runLocally,
    packageJsonPresent: pkg !== null,
  });

  return {
    repoId,
    hasClone,
    indexState,
    stack,
    repoMap,
    criticalPaths,
    runLocally,
    readingPath,
    topSymbols,
    allowedPaths,
  };
}

/**
 * Run a repo-intel read, degrading to a fallback on any throw. The facade is
 * degrade-not-throw by contract, so this is belt-and-braces — it guarantees the
 * degrade-never-throw property of `gatherFacts` even if a future facade method
 * regresses.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Read a clone file, mapping any throw (missing / symlink-refused) to null. */
async function safeReadFile(container: Container, repo: RepoRow, path: string): Promise<string | null> {
  try {
    return await container.git.readFile(repo, path);
  } catch {
    return null;
  }
}

/** List tracked clone files, mapping any throw (gone/unreadable clone) to []. */
async function safeListFiles(container: Container, repo: RepoRow): Promise<string[]> {
  try {
    return await container.git.listFiles(repo);
  } catch {
    return [];
  }
}
