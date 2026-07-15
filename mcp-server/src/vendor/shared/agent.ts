import { z } from 'zod';

/**
 * Vendored minimal slice of `@devdigest/shared`'s Agent contract
 * (server/src/vendor/shared/contracts/knowledge.ts). Only the fields this MCP
 * server actually reads are copied.
 */

export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  enabled: z.boolean(),
});
export type Agent = z.infer<typeof Agent>;
