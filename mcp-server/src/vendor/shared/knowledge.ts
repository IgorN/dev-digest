import { z } from 'zod';

/**
 * Vendored minimal slice of `@devdigest/shared`'s ConventionCandidate contract
 * (server/src/vendor/shared/contracts/knowledge.ts). Only the fields this MCP
 * server actually reads are copied.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  category: z.string().nullish(),
  rule: z.string(),
  evidence_path: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;
