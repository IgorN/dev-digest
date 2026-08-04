import PQueue from 'p-queue';

/**
 * Bounded worker pool — pure, zero-I/O, so the concurrency SEMANTICS of the
 * agent fan-out are unit-testable without a database, an LLM or a Fastify
 * instance.
 *
 * Thin wrapper over the `p-queue` pattern this codebase already uses for
 * scoped fan-outs (`eval/service.ts:runBatch`, `repo-intel/pipeline/full.ts`):
 * a FRESH queue per call, never a shared/persistent one like
 * `platform/jobs.ts`'s `JobRunner`. It exists as its own named function only so
 * the "never more than `limit` in flight" and "one rejection does not abort the
 * others" guarantees can be asserted directly.
 *
 * Contract:
 *  - starts tasks concurrently, never more than `limit` in flight at once;
 *  - runs EVERY item to settlement even if some reject — per-task error
 *    handling is deliberately the caller's job (the review executor's per-job
 *    `try/catch` already persists a failed run's status, error and trace), so
 *    this helper resolves rather than rejecting and never swallows a task the
 *    caller still wanted to run;
 *  - resolves once every task has settled.
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = new PQueue({ concurrency: Math.max(1, limit) });
  // allSettled (not all): a rejecting task must not short-circuit the await
  // while its siblings are still in flight — that is exactly the per-agent
  // failure isolation the fan-out is required to preserve.
  await Promise.allSettled(items.map((item) => queue.add(() => fn(item))));
}
