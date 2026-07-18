import { z } from 'zod';

/**
 * Vendored minimal slice of `@devdigest/shared`'s RunSummary contract
 * (server/src/vendor/shared/contracts/trace.ts). `status` is free text on the
 * upstream DB column; the only values the server ever writes are
 * 'running' | 'done' | 'failed' | 'cancelled' (server/src/modules/reviews/run-executor.ts).
 */
export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.string().nullable(),
  error: z.string().nullable(),
  ran_at: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
