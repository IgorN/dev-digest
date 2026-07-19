/**
 * Onboarding skeleton — PURE domain assembly (onion domain core; zero I/O).
 *
 * Turns an internal `FactsBundle` (built by `facts.ts`, the application ring)
 * into the DETERMINISTIC base `Onboarding` payload: always all 5 sections in a
 * fixed order, honest bodies grounded only in real facts, and links filtered to
 * the gathered-facts allow-list (AC-9). This skeleton is the BASE (Rec-4) — the
 * single LLM call in `generate.ts` enriches its bodies/diagrams, and it is ALSO
 * the fallback returned verbatim when the index is degraded/absent (AC-11) or
 * the model call fails (AC-12). No `container`, no LLM, no clone — pure in,
 * pure out.
 */
import type { Onboarding, OnboardingLink, OnboardingSection } from '@devdigest/shared';
import type { FactsBundle } from './facts.js';
import { buildLinksFromPaths, filterLinksToAllowed } from './helpers.js';
import { PACKAGE_JSON_PATH, RUN_LOCALLY_COMMAND_CAP } from './constants.js';

/**
 * The five section kinds in their FIXED wire order (AC-7). Exported so
 * `generate.ts` normalizes the model's output to exactly this set and order.
 * Only `architecture` may carry a `diagram` (AC-8).
 */
export const ONBOARDING_KINDS = [
  'architecture',
  'critical-paths',
  'run-locally',
  'reading-path',
  'first-tasks',
] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];

/** Human-readable section titles (skeleton defaults; the model may override). */
const SECTION_TITLES: Record<OnboardingKind, string> = {
  architecture: 'Architecture',
  'critical-paths': 'Critical paths',
  'run-locally': 'Run locally',
  'reading-path': 'Reading path',
  'first-tasks': 'First tasks',
};

/** At most this many links per section (mirrors the prompt's "up to 4" rule). */
const LINK_CAP = 4;

/** How many critical-path chains to list in the skeleton body. */
const CRITICAL_PATH_CAP = 5;

/** How many top-symbol files seed the first-tasks suggestions. */
const FIRST_TASK_LINK_CAP = 5;

/**
 * Build the deterministic 5-section `Onboarding` skeleton from a `FactsBundle`.
 * Always emits all five kinds in fixed order (AC-7); `first-tasks` is present
 * even on a degraded index (D3). Only `architecture` gets a (null-in-skeleton)
 * diagram slot; every other section's `diagram` is `null`, never `''` (AC-8).
 * Top-level index-state metadata comes straight from the bundle; `generated_at`
 * is intentionally omitted — the repository stamps it on upsert.
 */
export function buildSkeleton(facts: FactsBundle): Onboarding {
  const sections: OnboardingSection[] = ONBOARDING_KINDS.map((kind) => buildSection(kind, facts));
  return {
    sections,
    index_state: facts.indexState.status,
    degraded_reason: facts.indexState.reason,
    files_indexed: facts.indexState.filesIndexed,
  };
}

function buildSection(kind: OnboardingKind, facts: FactsBundle): OnboardingSection {
  return {
    kind,
    title: SECTION_TITLES[kind],
    body: buildBody(kind, facts),
    diagram: null, // Only `architecture` may later carry a model diagram (AC-8).
    // Only `run-locally` carries runnable commands; `null` everywhere else,
    // exactly like `diagram` is `null` outside `architecture`.
    commands: kind === 'run-locally' ? nullIfEmpty(buildRunLocallyCommands(facts)) : null,
    links: buildLinks(kind, facts),
  };
}

// ---------------------------------------------------------------------------
// Deterministic, honest section bodies (never fabricate — AC-9/AC-13)
// ---------------------------------------------------------------------------

function buildBody(kind: OnboardingKind, facts: FactsBundle): string {
  switch (kind) {
    case 'architecture':
      return architectureBody(facts);
    case 'critical-paths':
      return criticalPathsBody(facts);
    case 'run-locally':
      return runLocallyBody(facts);
    case 'reading-path':
      return readingPathBody(facts);
    case 'first-tasks':
      return firstTasksBody(facts);
  }
}

function architectureBody(facts: FactsBundle): string {
  const { stack } = facts;
  const parts: string[] = [];
  if (stack.packageName) parts.push(`**Package:** \`${stack.packageName}\``);
  if (stack.frameworks.length > 0) parts.push(`**Detected stack:** ${stack.frameworks.join(', ')}`);
  if (parts.length === 0) {
    return 'Not enough indexed data to describe the architecture yet. Clone and index this repository to populate this section.';
  }
  return parts.join('\n\n');
}

function criticalPathsBody(facts: FactsBundle): string {
  const chains = facts.criticalPaths.filter((chain) => chain.length > 0).slice(0, CRITICAL_PATH_CAP);
  if (chains.length === 0) {
    return 'No critical dependency paths are available from the current index. This usually means the repository is not fully indexed yet.';
  }
  const lines = chains.map((chain) => `- ${chain.map((p) => `\`${p}\``).join(' → ')}`);
  return `Key dependency chains through the codebase:\n\n${lines.join('\n')}`;
}

/**
 * The DETERMINISTIC run-locally command sequence, in the order a newcomer runs
 * them: env template first, then dependencies, then the package scripts. Built
 * ONLY from detected facts — nothing is invented (AC-13). We never guess a
 * package manager: `RunLocallyFacts` carries no lockfile signal, so `npm run
 * <name>` is the honest default for a `package.json` script.
 */
function buildRunLocallyCommands(facts: FactsBundle): string[] {
  const { runLocally } = facts;
  if (!runLocally.hasSignals) return [];
  const commands: string[] = [];
  if (runLocally.hasEnvExample) commands.push('cp .env.example .env');
  if (runLocally.hasDockerCompose) commands.push('docker compose up -d');
  for (const script of runLocally.scripts) {
    const name = script.name.trim();
    if (name) commands.push(`npm run ${name}`);
  }
  return commands.slice(0, RUN_LOCALLY_COMMAND_CAP);
}

function nullIfEmpty(commands: string[]): string[] | null {
  return commands.length > 0 ? commands : null;
}

/**
 * Narration only — the runnable commands live in the structured `commands`
 * field, so the body must NOT repeat them as a code block (the UI would render
 * the same information twice).
 */
function runLocallyBody(facts: FactsBundle): string {
  const { runLocally } = facts;
  if (!runLocally.hasSignals) {
    // D1: degrade to a generic pointer when no deterministic signal was found.
    return 'No deterministic run instructions were detected. See the repository README for how to install and run this project locally.';
  }
  const parts: string[] = [];
  if (runLocally.hasEnvExample) {
    parts.push('Copy the example environment file and fill in the required values before running.');
  }
  if (runLocally.hasDockerCompose) {
    parts.push('A Docker Compose file is present — you can bring dependencies up with `docker compose up`.');
  }
  if (parts.length === 0) {
    // Scripts-only repo: the commands themselves are structured, so the body
    // just says where they came from rather than listing them again.
    parts.push('Run the project with the scripts declared in its `package.json`.');
  }
  return parts.join('\n\n');
}

function readingPathBody(facts: FactsBundle): string {
  if (facts.readingPath.length === 0) {
    return 'Not enough indexed data to suggest a reading order yet. Index this repository to rank its files by centrality.';
  }
  const lines = facts.readingPath.map((entry, i) => `${i + 1}. \`${entry.path}\``);
  return `Read these files in order — highest-ranked (most central) first:\n\n${lines.join('\n')}`;
}

function firstTasksBody(facts: FactsBundle): string {
  // D3: always present, honest generic guidance when there is nothing to ground on.
  const files = uniquePaths(facts.topSymbols.map((s) => s.file)).slice(0, FIRST_TASK_LINK_CAP);
  if (files.length === 0) {
    return [
      'Once this repository is fully indexed, this section will suggest small, self-contained first changes grounded in real files.',
      'In the meantime: start from the reading path above, run the test suite, and make a small documentation or test improvement to get familiar with the workflow.',
    ].join('\n\n');
  }
  const lines = files.map(
    (file) =>
      `- Explore \`${file}\` and make a small, self-contained improvement (a focused test, a doc comment, or a minor refactor).`,
  );
  return `Good first changes to get familiar with the codebase:\n\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Deterministic links — real paths only, filtered to the allow-list (AC-9)
// ---------------------------------------------------------------------------

function buildLinks(kind: OnboardingKind, facts: FactsBundle): OnboardingLink[] {
  const paths = candidatePaths(kind, facts);
  const links = filterLinksToAllowed(buildLinksFromPaths(paths), facts.allowedPaths);
  return links.slice(0, LINK_CAP);
}

function candidatePaths(kind: OnboardingKind, facts: FactsBundle): string[] {
  switch (kind) {
    case 'architecture':
      // Structural entry points: the manifest + the most central files.
      return [
        ...(facts.stack.packageName || facts.allowedPaths.has(PACKAGE_JSON_PATH) ? [PACKAGE_JSON_PATH] : []),
        ...facts.readingPath.map((e) => e.path),
      ];
    case 'critical-paths':
      return facts.criticalPaths.flat();
    case 'run-locally':
      return [...facts.runLocally.files, PACKAGE_JSON_PATH];
    case 'reading-path':
      return facts.readingPath.map((e) => e.path);
    case 'first-tasks':
      return facts.topSymbols.map((s) => s.file);
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
