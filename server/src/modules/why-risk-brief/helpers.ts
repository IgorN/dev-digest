import type {
  BlastRadius,
  DocumentInventoryItem,
  Intent,
  Risk,
  RiskSeverity,
  ReviewFocusItem,
  SmartDiff,
  SmartDiffRole,
  WhyRiskBrief,
} from '@devdigest/shared';
import { DEGRADED_SKELETON_RISK_LEVEL } from './constants.js';

/**
 * Why + Risk Brief — pure domain helpers (onion domain ring; zero I/O).
 *
 * Grounding set assembly + the AC-5 grounding gate, the AC-12 deterministic
 * context-doc selection heuristic, the AC-11 never-fabricate degraded
 * skeleton, and the AC-1 smart-diff count summarizer. Unit-tested directly
 * by a sibling task (`why-risk-brief-helpers.test.ts`) — no DB, no Fastify,
 * no LLM.
 */

/**
 * The set of file paths a brief's `risks[].file_refs` / `review_focus[].file`
 * are allowed to cite: the PR's own diff files, plus — when a blast map is
 * available — every symbol-declaring file and every downstream caller's
 * file. Grounding in diff files alone (AC-9) is what a caller gets when
 * `blast` is `undefined` (degraded/absent blast map).
 */
export function buildGroundingSet(
  files: { path: string }[],
  blast: BlastRadius | undefined,
): Set<string> {
  const set = new Set<string>(files.map((f) => f.path));
  if (blast) {
    for (const symbol of blast.changed_symbols) set.add(symbol.file);
    for (const impact of blast.downstream) {
      for (const caller of impact.callers) set.add(caller.file);
    }
  }
  return set;
}

/** The five synthesized brief fields — same shape in and out of `groundBrief`. */
export interface BriefContent {
  what: string;
  why: string;
  risk_level: RiskSeverity;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
}

/**
 * The AC-5 grounding gate: NOT `reviewer-core`'s `groundFindings()` — that
 * gate intersects a `Finding[]`'s line numbers against real diff hunks; this
 * is a different, purpose-built check over file-path SET MEMBERSHIP against
 * `groundingSet` (`Risk`/`ReviewFocusItem` are not `Finding` objects). Named
 * distinctly (`groundBrief`, not `groundFindings`) so the two are never
 * confused.
 *
 * A risk that cites a fabricated path loses just that ref — the risk itself
 * is always kept, even with an empty `file_refs` (a risk can be real without
 * pointing at a specific file). A `review_focus` item whose `file` isn't a
 * member is dropped entirely — unlike a risk, a focus item's entire purpose
 * is to point somewhere real, so one with no valid file carries no signal.
 */
export function groundBrief(raw: BriefContent, groundingSet: Set<string>): BriefContent {
  return {
    what: raw.what,
    why: raw.why,
    risk_level: raw.risk_level,
    risks: raw.risks.map((risk) => ({
      ...risk,
      file_refs: risk.file_refs.filter((path) => groundingSet.has(path)),
    })),
    review_focus: raw.review_focus.filter((item) => groundingSet.has(item.file)),
  };
}

/**
 * Docs whose PATH matches this (case-insensitive, anywhere in the repo-
 * relative path — not just the file's base name, so e.g.
 * `docs/architecture/overview.md` still qualifies) are preferred by
 * `selectContextDocs` (AC-12's "architecture/invariant/convention-named"
 * heuristic).
 */
const PREFERRED_NAME_PATTERN = /architecture|invariant|convention/i;

/**
 * AC-12's deterministic, zero-model context-doc selection: partition into
 * preferred (architecture/invariant/convention-named) vs. the rest, sort
 * EACH group ascending by `token_estimate` (smallest-first tiebreak within
 * its group), preferred group first, then take the first `maxDocs`. Stable
 * across repeated calls with the same input — `Array.prototype.sort` is a
 * stable sort, and this never mutates `items` itself (only the two local
 * partition arrays).
 */
export function selectContextDocs(
  items: DocumentInventoryItem[],
  maxDocs: number,
): DocumentInventoryItem[] {
  const preferred: DocumentInventoryItem[] = [];
  const rest: DocumentInventoryItem[] = [];
  for (const item of items) {
    (PREFERRED_NAME_PATTERN.test(item.path) ? preferred : rest).push(item);
  }
  const bySizeAscending = (a: DocumentInventoryItem, b: DocumentInventoryItem) =>
    a.token_estimate - b.token_estimate;
  preferred.sort(bySizeAscending);
  rest.sort(bySizeAscending);
  return [...preferred, ...rest].slice(0, maxDocs);
}

/**
 * AC-11's deterministic fallback: built FIRST by the service, before the one
 * synthesis call is attempted, so a valid brief always exists to fall back
 * to. Never fabricates — `what`/`why` reuse the PR's own already-persisted
 * `intent.intent` when present (the one honest description already on
 * hand), or a static sentence naming only `prTitle` when it's not. `risks`/
 * `review_focus` are empty rather than guessed; `risk_level` is the fixed
 * neutral `DEGRADED_SKELETON_RISK_LEVEL`, never a computed floor.
 */
export function buildDegradedSkeleton(
  prTitle: string,
  intent: Intent | undefined,
  reason: string,
): WhyRiskBrief {
  const fallbackText = intent
    ? intent.intent
    : `No summary is available yet for "${prTitle}" — the risk brief could not be generated ` +
      'and no persisted intent was found to fall back on.';
  return {
    what: fallbackText,
    why: fallbackText,
    risk_level: DEGRADED_SKELETON_RISK_LEVEL,
    risks: [],
    review_focus: [],
    degraded: true,
    degraded_reason: reason,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
  };
}

/**
 * Pure map from a `SmartDiff` (already computed elsewhere, zero LLM) to the
 * small per-role file-count summary this feature's prompt uses in place of
 * the full grouped file/finding data — "N core, M wiring, K boilerplate"
 * (spec's own Input-provenance framing), never the underlying diff bodies.
 */
export function summarizeSmartDiffCounts(
  smartDiff: SmartDiff,
): { role: SmartDiffRole; count: number }[] {
  return smartDiff.groups.map((group) => ({ role: group.role, count: group.files.length }));
}
