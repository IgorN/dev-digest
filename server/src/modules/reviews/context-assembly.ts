import { approxTokens, isPathSafe, truncateToBytes } from '../context/helpers.js';

/**
 * Pure run-time assembly of attached Project Context documents. NO I/O — the
 * executor does the clone reads (`container.git.readFile`) and hands the
 * results here. Reuses the single estimator/cap/path-guard primitives from
 * `modules/context/helpers.ts` so save-time validation, the editor estimate,
 * and the trace all agree (AC-12/AC-14/AC-18/AC-19).
 */

export type SpecInjectionStatus = 'injected' | 'truncated' | 'skipped_missing';

/** One trace `specs_injected` entry (vendored RunTrace contract shape). */
export interface SpecInjection {
  path: string;
  tokens: number;
  status: SpecInjectionStatus;
}

/** The executor's read result for one assembled path. `null` = the clone read
 *  failed (missing/unreadable file) or was refused (unsafe path, never read). */
export interface ContextDocRead {
  path: string;
  content: string | null;
}

export interface ContextInjection {
  /** Injected doc contents, assembled order — the `specs` input to reviewPullRequest. */
  specs: string[];
  /** Paths actually injected (incl. truncated) — the trace's `specs_read`. */
  specsRead: string[];
  /** Per-path outcome for EVERY path in the assembled set (incl. skips) —
   *  the trace's `specs_injected`. */
  specsInjected: SpecInjection[];
}

/**
 * AC-8 assembly order: the agent's own attached paths first (listed order),
 * then skill-inherited paths (skills in link order, each skill's docs in
 * listed order). Each distinct path appears at most once — first occurrence
 * wins, so a path attached both directly and via a skill keeps its agent-level
 * position. Callers pass ONLY enabled skills' lists (a disabled skill's docs
 * are omitted entirely, mirroring the skills-body wiring).
 */
export function assembleContextPaths(
  agentPaths: readonly string[],
  skillPathLists: readonly (readonly string[])[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of [...agentPaths, ...skillPathLists.flat()]) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Map read results (assembled order) to the final injection: unsafe or
 * unreadable/missing → `skipped_missing` (AC-16/AC-19, tokens 0, nothing
 * injected); over `maxBytes` → truncated at the cap with a visible marker,
 * `status: 'truncated'` (AC-18); else `injected`. Tokens are estimated over
 * the content ACTUALLY injected (the truncated text when truncated).
 */
export function buildContextInjection(
  reads: readonly ContextDocRead[],
  maxBytes: number,
): ContextInjection {
  const specs: string[] = [];
  const specsRead: string[] = [];
  const specsInjected: SpecInjection[] = [];

  for (const { path, content } of reads) {
    // Defensive re-check: the executor already refuses to read unsafe paths,
    // but a caller handing content for one must still never inject it.
    if (content === null || !isPathSafe(path)) {
      specsInjected.push({ path, tokens: 0, status: 'skipped_missing' });
      continue;
    }
    const { text, truncated } = truncateToBytes(content, maxBytes);
    specs.push(text);
    specsRead.push(path);
    specsInjected.push({
      path,
      tokens: approxTokens(text.length),
      status: truncated ? 'truncated' : 'injected',
    });
  }

  return { specs, specsRead, specsInjected };
}
