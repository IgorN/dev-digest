import { z } from 'zod';

/**
 * Vendored minimal slice of `@devdigest/shared`'s Repo/PrMeta contracts
 * (server/src/vendor/shared/contracts/platform.ts). Only the identifier
 * fields this MCP server needs to resolve `repo`/`pr_number` are copied.
 */

export const Repo = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
});
export type Repo = z.infer<typeof Repo>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
});
export type PrMeta = z.infer<typeof PrMeta>;
