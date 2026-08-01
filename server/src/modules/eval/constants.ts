/**
 * Eval module constants.
 */

/**
 * Scoped concurrency cap for running a batch of eval cases against one agent
 * config. Mirrors `repo-intel/pipeline/full.ts`'s scoped `PQueue` pattern (a
 * fresh queue per call, not a persistent/shared one like `platform/jobs.ts`) —
 * each `runBatch` call gets its own queue, bounded so a large case set can't
 * fan out unboundedly many concurrent LLM calls.
 */
export const MAX_CONCURRENT_CASE_REVIEWS = 4;

/** Default "recent batches" page size for a single agent's dashboard. */
export const DEFAULT_TREND_LIMIT = 20;

/** Default "recent batches" page size for the workspace-wide dashboard. */
export const DEFAULT_WORKSPACE_TREND_LIMIT = 50;
