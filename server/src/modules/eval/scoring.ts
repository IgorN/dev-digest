import type { Finding } from '@devdigest/shared';
import type { ExpectationItem, ExtraFinding, ExtraFindingTag, MatchResult } from './types.js';

/**
 * Eval scoring — pure, zero-I/O functions. No LLM calls anywhere in this
 * file; every score is computed 100% in code from already-produced,
 * already-grounded `Finding[]` (the citation gate has already run by the
 * time anything here is called).
 */

/**
 * Closed-integer-interval overlap check. Mirrors the semantics of
 * `reviewer-core/src/grounding.ts`'s private `rangeIntersects` (lines 41-46,
 * not exported — reviewer-core is not to be modified by this feature, so the
 * logic is faithfully replicated here rather than imported). That function
 * checks "does any integer line in [lo,hi] belong to a given set of lines";
 * for two closed integer ranges this is exactly equivalent to the standard
 * interval-overlap test below (`aLo <= bHi && bLo <= aHi`) — two ranges
 * overlap iff at least one integer line is common to both. Adjacent,
 * non-overlapping ranges (e.g. [1,5] and [6,10]) do NOT overlap; a single
 * shared boundary line (e.g. [1,5] and [5,10]) DOES.
 */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * Match each expectation item against the grounded (already citation-gate-
 * passed) findings a run produced. `matched: true` means some grounded
 * finding shares the expectation's `file` and its [start_line, end_line]
 * range overlaps the expectation's own [start_line, end_line ?? start_line]
 * range — for BOTH `must_find` and `must_not_flag` items; the caller
 * (computeRecall/computePrecision) is responsible for interpreting what
 * "matched" means for each type (see `types.ts`'s `MatchResult` doc comment).
 */
export function matchExpectations(
  expected: ExpectationItem[],
  groundedFindings: Finding[],
): MatchResult[] {
  return expected.map((item) => {
    const end = item.end_line ?? item.start_line;
    const finding = groundedFindings.find(
      (f) => f.file === item.file && rangesOverlap(item.start_line, end, f.start_line, f.end_line),
    );
    return { item, matched: finding !== undefined, finding };
  });
}

/** AC-14: citation accuracy = kept / (kept + dropped); 1.0 when both zero. */
export function computeCitationAccuracy(kept: number, dropped: number): number {
  const total = kept + dropped;
  return total === 0 ? 1.0 : kept / total;
}

/**
 * AC-15/AC-16: recall = matched `must_find` items / total `must_find` items;
 * 1.0 when there are zero `must_find` items in `expected` (e.g. a case made
 * entirely of `must_not_flag` items).
 */
export function computeRecall(expected: ExpectationItem[], matches: MatchResult[]): number {
  const totalMustFind = expected.filter((item) => item.type === 'must_find').length;
  if (totalMustFind === 0) return 1.0;
  const matchedMustFind = matches.filter(
    (m) => m.item.type === 'must_find' && m.matched,
  ).length;
  return matchedMustFind / totalMustFind;
}

/**
 * AC-17/AC-18: precision = (grounded findings backed by >=1 matched
 * `must_find` item) / (grounded findings total); 1.0 when zero grounded
 * findings were produced. A grounded finding NOT backed by any `must_find`
 * item counts against precision regardless of whether it ALSO matches a
 * `must_not_flag` item — see `classifyExtraFindings` for the UI/trace-only
 * tag that distinguishes the two cases without affecting this number.
 */
export function computePrecision(groundedFindings: Finding[], matches: MatchResult[]): number {
  if (groundedFindings.length === 0) return 1.0;
  const backedFindingIds = new Set(
    matches
      .filter((m) => m.item.type === 'must_find' && m.matched && m.finding)
      .map((m) => m.finding!.id),
  );
  const backedCount = groundedFindings.filter((f) => backedFindingIds.has(f.id)).length;
  return backedCount / groundedFindings.length;
}

/** AC-19: a case passes iff both recall and precision are exactly 1.0. */
export function computePass(recall: number, precision: number): boolean {
  return recall === 1.0 && precision === 1.0;
}

/**
 * UI/trace-only classification of grounded findings that do not back any
 * `must_find` expectation (AC-18): `confirmed_noise` when the finding also
 * matches a `must_not_flag` item's file/line, `unbacked_extra` otherwise.
 * Both tags debit precision identically — this function never affects
 * `computePrecision`'s number, it only explains it.
 */
export function classifyExtraFindings(
  groundedFindings: Finding[],
  matches: MatchResult[],
): ExtraFinding[] {
  const backedFindingIds = new Set(
    matches
      .filter((m) => m.item.type === 'must_find' && m.matched && m.finding)
      .map((m) => m.finding!.id),
  );
  const mustNotFlagViolationIds = new Set(
    matches
      .filter((m) => m.item.type === 'must_not_flag' && m.matched && m.finding)
      .map((m) => m.finding!.id),
  );
  const extras: ExtraFinding[] = [];
  for (const finding of groundedFindings) {
    if (backedFindingIds.has(finding.id)) continue;
    const tag: ExtraFindingTag = mustNotFlagViolationIds.has(finding.id)
      ? 'confirmed_noise'
      : 'unbacked_extra';
    extras.push({ finding, tag });
  }
  return extras;
}
