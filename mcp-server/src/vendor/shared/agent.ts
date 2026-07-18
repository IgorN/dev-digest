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
  // Added for the `devdigest review --mode working` CLI (pre-push): the
  // trusted system prompt reviewPullRequest needs to reuse the SAME agent
  // config the product runs on PRs, not a hand-copied duplicate. Untouched
  // by narrowAgent()'s MCP-tool output shaping — existing tools are unaffected.
  system_prompt: z.string(),
});
export type Agent = z.infer<typeof Agent>;
