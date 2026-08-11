/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Max agent jobs executing simultaneously inside ONE fan-out.
 *
 * 4 is the design's canonical fan-out size, so the common case runs in a single
 * wave at full parallelism, while a "Run all" over a larger agent roster is
 * still bounded to 4 simultaneous LLM calls — comfortably inside a single
 * provider key's concurrency budget and far below the launch route's existing
 * 10 requests/minute per-route limit. Referenced by `run-executor.ts`; never
 * inline the number at the call site.
 *
 * Same scoped-queue shape as `eval/constants.ts`'s `MAX_CONCURRENT_CASE_REVIEWS`
 * (a fresh `PQueue` per call, not the persistent one in `platform/jobs.ts`).
 */
export const AGENT_FANOUT_CONCURRENCY = 4;
