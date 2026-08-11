import type { Finding } from '@devdigest/shared';

/**
 * Eval — server-internal (non-Zod, non-vendored) types.
 *
 * `expected_output` on `EvalCaseInput`/`EvalCase`
 * (`src/vendor/shared/contracts/eval-ci.ts`) is `z.unknown()` — it carries an
 * informal, reviewer- or system-authored JSON array of `ExpectationItem`, never
 * model-generated, and is NOT itself Zod-validated server-side beyond "is a
 * JSON array" (per the eval-pipeline spec). These types exist purely so
 * `scoring.ts`/`helpers.ts` (and their tests) share one shape instead of each
 * re-declaring it. Zero I/O, zero logic — types only.
 */

/** One item inside `expected_output`. */
export interface ExpectationItem {
  type: 'must_find' | 'must_not_flag';
  file: string;
  start_line: number;
  /** Defaults to `start_line` when omitted (a single-line expectation). */
  end_line?: number;
  severity?: string;
  category?: string;
  title?: string;
}

/**
 * Tag on a grounded, produced finding that has no matching `must_find`
 * expectation and therefore debits precision (AC-18). Both tags debit
 * precision identically — the tag exists only for UI/trace explanation, never
 * for differential scoring.
 */
export type ExtraFindingTag = 'confirmed_noise' | 'unbacked_extra';

/**
 * Outcome of matching one `ExpectationItem` against the grounded findings a
 * run actually produced.
 *
 * - `must_find` items: `matched: true` means some grounded finding overlaps
 *   the same file + [start_line, end_line] range (mirroring
 *   `reviewer-core/src/grounding.ts`'s `rangeIntersects`); `finding` is that
 *   match, if any.
 * - `must_not_flag` items: `matched: true` means a grounded finding WAS
 *   produced at that location (i.e. the "don't flag this" expectation was
 *   violated); `finding` is the offending finding, if any.
 */
export interface MatchResult {
  item: ExpectationItem;
  matched: boolean;
  finding?: Finding;
}

/**
 * A grounded, produced finding that does not correspond to any `must_find`
 * expectation. Counted against precision (AC-17/AC-18); `tag` records WHY
 * (confirmed noise = it also matches a `must_not_flag` item; unbacked extra =
 * it matches no expectation at all) for UI/trace purposes only.
 */
export interface ExtraFinding {
  finding: Finding;
  tag: ExtraFindingTag;
}
