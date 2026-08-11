/**
 * Onboarding facts — PURE domain transforms (onion domain core; zero I/O).
 *
 * Everything here is deterministic and side-effect-free: parse a manifest,
 * detect a stack, enumerate scripts, sort the reading-path by rank, build the
 * path allow-list, and shape links. No DB, no clone, no `container`, no LLM —
 * `facts.ts` (the application ring) does the I/O and feeds these functions their
 * inputs. T4's `skeleton.ts` imports the link/allow-list helpers to build the
 * Onboarding payload; it never re-derives them.
 */
import type { OnboardingLink } from '@devdigest/shared';
import type { FileRankRow, IndexState, IndexStatus, SymbolRow } from '../repo-intel/types.js';
import { ENV_EXAMPLE_NAMES, FRAMEWORK_MARKERS, PACKAGE_JSON_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// Pure fact shapes (domain entities). Defined here in the core so the
// application ring (`facts.ts`) depends inward on them, never the reverse.
// ---------------------------------------------------------------------------

/** A loosely-typed, best-effort view of a repo's root `package.json`. */
export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface StackFacts {
  packageName: string | null;
  /** Friendly framework/library labels detected from the manifest deps. */
  frameworks: string[];
  dependencies: string[];
  devDependencies: string[];
}

export interface ScriptFact {
  name: string;
  command: string;
}

export interface RunLocallyFacts {
  scripts: ScriptFact[];
  hasEnvExample: boolean;
  hasDockerCompose: boolean;
  /** True when any deterministic run-locally signal was found (D1). */
  hasSignals: boolean;
  /** Real repo-relative paths of the detected env/compose files (allow-list fuel). */
  files: string[];
}

export interface ReadingPathEntry {
  path: string;
  /** file_rank percentile; higher = more central. Missing rank → 0. */
  rank: number;
}

export interface SymbolFact {
  file: string;
  name: string;
  kind: string;
}

/** Effective index state, folding the no-clone case into the degraded contract. */
export interface FactsIndexState {
  status: IndexStatus;
  degraded: boolean;
  reason: string | null;
  filesIndexed: number;
}

// ---------------------------------------------------------------------------
// package.json → stack / scripts
// ---------------------------------------------------------------------------

/**
 * Best-effort parse of a raw `package.json` string. Never throws — malformed
 * or absent JSON yields `null`, so a repo without a Node manifest (or with a
 * broken one) simply produces no stack/script facts (AC-13, degrade-not-throw).
 */
export function parsePackageJson(raw: string | null): PackageJson | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    scripts: asStringRecord(obj.scripts),
    dependencies: asStringRecord(obj.dependencies),
    devDependencies: asStringRecord(obj.devDependencies),
  };
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Deterministic stack detector: emit friendly labels ONLY for dependencies the
 * manifest actually lists (via `FRAMEWORK_MARKERS`) — never inferred from file
 * extensions or fabricated. No manifest → empty stack.
 */
export function detectStack(pkg: PackageJson | null): StackFacts {
  if (!pkg) {
    return { packageName: null, frameworks: [], dependencies: [], devDependencies: [] };
  }
  const dependencies = Object.keys(pkg.dependencies ?? {});
  const devDependencies = Object.keys(pkg.devDependencies ?? {});
  const frameworks: string[] = [];
  const seen = new Set<string>();
  for (const name of [...dependencies, ...devDependencies]) {
    const label = FRAMEWORK_MARKERS[name];
    if (label && !seen.has(label)) {
      seen.add(label);
      frameworks.push(label);
    }
  }
  return { packageName: pkg.name ?? null, frameworks, dependencies, devDependencies };
}

/** Enumerate `package.json` scripts as ordered {name, command} facts (D1 (c)). */
export function enumerateScripts(pkg: PackageJson | null): ScriptFact[] {
  if (!pkg?.scripts) return [];
  return Object.entries(pkg.scripts).map(([name, command]) => ({ name, command }));
}

// ---------------------------------------------------------------------------
// run-locally detection (D1)
// ---------------------------------------------------------------------------

const DOCKER_COMPOSE_RE = /^(?:docker-compose|compose)[^/]*\.ya?ml$/;

/**
 * Deterministic run-locally facts (D1): Node scripts + `.env.example` presence
 * + `docker-compose*` presence, all best-effort from the clone's tracked file
 * list. When nothing is found, `hasSignals` is false so the caller (T4) can
 * fall back to a generic "see the repo README" body.
 */
export function detectRunLocally(files: string[], scripts: ScriptFact[]): RunLocallyFacts {
  const envFiles: string[] = [];
  const composeFiles: string[] = [];
  for (const path of files) {
    const base = baseName(path);
    if (ENV_EXAMPLE_NAMES.includes(base)) envFiles.push(path);
    else if (DOCKER_COMPOSE_RE.test(base)) composeFiles.push(path);
  }
  const hasEnvExample = envFiles.length > 0;
  const hasDockerCompose = composeFiles.length > 0;
  return {
    scripts,
    hasEnvExample,
    hasDockerCompose,
    hasSignals: scripts.length > 0 || hasEnvExample || hasDockerCompose,
    files: [...envFiles, ...composeFiles],
  };
}

// ---------------------------------------------------------------------------
// reading-path ordering (AC-6)
// ---------------------------------------------------------------------------

/**
 * Order the reading-path by DESCENDING file rank (AC-6) — the import-graph
 * PageRank already materialised in `file_rank`, never name or mtime. Files with
 * no known rank sink to 0; ties preserve the incoming (already rank-sorted)
 * order via `Array.prototype.sort`'s stability.
 */
export function sortReadingPathByRank(paths: string[], ranks: FileRankRow[]): ReadingPathEntry[] {
  const rankOf = new Map(ranks.map((r) => [r.path, r.percentile]));
  return paths
    .map((path) => ({ path, rank: rankOf.get(path) ?? 0 }))
    .sort((a, b) => b.rank - a.rank);
}

/** Map read-model symbol rows to the trimmed first-tasks seed facts (AC-10). */
export function toSymbolFacts(rows: SymbolRow[]): SymbolFact[] {
  return rows.map((s) => ({ file: s.file, name: s.name, kind: s.kind }));
}

// ---------------------------------------------------------------------------
// index-state resolution (degraded contract)
// ---------------------------------------------------------------------------

/**
 * Fold `getIndexState` + the clone presence into a single effective index
 * state. The no-clone case (e.g. seeded `acme/payments-api`, `clonePath: null`)
 * is always degraded — the pipeline can only read intel from disk (AC-11).
 * `failed` is preserved as-is; `partial` stays a (degraded) partial.
 */
export function resolveIndexState(state: IndexState | null, hasClone: boolean): FactsIndexState {
  const filesIndexed = state?.filesIndexed ?? 0;
  const rawReason = state?.reason ?? state?.degradedReason ?? null;
  if (!state) {
    return { status: 'degraded', degraded: true, reason: rawReason ?? 'index state unavailable', filesIndexed };
  }
  if (state.status === 'failed') {
    return { status: 'failed', degraded: true, reason: rawReason ?? 'index build failed', filesIndexed };
  }
  if (!hasClone) {
    return { status: 'degraded', degraded: true, reason: 'no local clone', filesIndexed };
  }
  if (state.degraded || state.status === 'degraded') {
    return { status: 'degraded', degraded: true, reason: rawReason ?? 'index degraded', filesIndexed };
  }
  if (state.status === 'partial') {
    return { status: 'partial', degraded: true, reason: rawReason ?? 'index partial', filesIndexed };
  }
  return { status: 'full', degraded: false, reason: null, filesIndexed };
}

// ---------------------------------------------------------------------------
// path allow-list (AC-9) + link building
// ---------------------------------------------------------------------------

/**
 * Union of EVERY real repo-relative path seen while gathering facts — reading
 * path, critical-path chains, first-task symbol files, detected run-locally
 * files, and the manifest itself. T4 filters every model-proposed
 * `OnboardingLink.path` against this set so no invented path survives (AC-9).
 */
export function buildAllowedPaths(input: {
  readingPath: ReadingPathEntry[];
  criticalPaths: string[][];
  symbols: SymbolFact[];
  runLocally: RunLocallyFacts;
  packageJsonPresent: boolean;
}): Set<string> {
  const set = new Set<string>();
  for (const entry of input.readingPath) set.add(entry.path);
  for (const chain of input.criticalPaths) for (const path of chain) set.add(path);
  for (const symbol of input.symbols) set.add(symbol.file);
  for (const file of input.runLocally.files) set.add(file);
  if (input.packageJsonPresent) set.add(PACKAGE_JSON_PATH);
  return set;
}

/** Build de-duplicated links from real paths, labelling each with its base name. */
export function buildLinksFromPaths(paths: string[]): OnboardingLink[] {
  const seen = new Set<string>();
  const links: OnboardingLink[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    links.push({ label: baseName(path), path });
  }
  return links;
}

/** Drop any link whose `path` is not in the gathered-facts allow-list (AC-9). */
export function filterLinksToAllowed(links: OnboardingLink[], allowed: Set<string>): OnboardingLink[] {
  return links.filter((link) => allowed.has(link.path));
}

/** Last path segment (pure string op — not `node:path`, so it stays I/O-free). */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
