import { z } from 'zod';

/**
 * Vendored minimal slice of `@devdigest/shared`'s findings contracts
 * (server/src/vendor/shared/contracts/findings.ts). Only the fields this MCP
 * server actually reads/returns are copied — keep in sync by hand if the
 * upstream contract changes (see server/CLAUDE.md's vendoring convention).
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

/** Finding — the atomic review unit (subset of the full upstream shape). */
export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number().min(0).max(1),
});
export type Finding = z.infer<typeof Finding>;

/** Minimal slice of `ReviewDto` (server/src/modules/reviews/helpers.ts) — just
 *  the fields get_findings needs to match a review to its run_id. */
export const ReviewRecord = z.object({
  run_id: z.string().nullable(),
  verdict: z.string().nullable(),
  findings: z.array(Finding),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;
