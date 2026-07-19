import { z } from 'zod';

/**
 * Project Context — markdown documents discovered in a repo clone under the
 * configured context roots (default: specs / docs / insights). Paths are
 * repo-relative; document content is never persisted, only read from the
 * clone at run time and injected into the untrusted `## Project context`
 * prompt slot.
 */

export const DocumentInventoryItem = z.object({
  /** Repo-relative path, e.g. "server/specs/review-flow.md". */
  path: z.string(),
  /** Which configured root matched: "specs" | "docs" | "insights" | custom. */
  root: z.string(),
  /** Deterministic estimate over current content (~ceil(chars/4)); 0 when unreadable. */
  token_estimate: z.number().int(),
});
export type DocumentInventoryItem = z.infer<typeof DocumentInventoryItem>;

export const ContextInventory = z.object({
  repo_id: z.string(),
  /** False when the repo has no local clone (inventory is then always empty). */
  has_clone: z.boolean(),
  count: z.number().int(),
  items: z.array(DocumentInventoryItem),
});
export type ContextInventory = z.infer<typeof ContextInventory>;

export const ContextDocumentPreview = z.object({
  repo_id: z.string(),
  path: z.string(),
  root: z.string(),
  /** Current content read from the clone, capped at the per-doc byte limit. */
  content: z.string(),
  truncated: z.boolean(),
  token_estimate: z.number().int(),
});
export type ContextDocumentPreview = z.infer<typeof ContextDocumentPreview>;
