/* Pure helpers for the Agent Editor's Evals tab (L06 — Eval Pipeline). Zero
   I/O; the component owns all data fetching via lib/hooks/eval. */
import type { Category, Severity } from "@devdigest/ui";
import type { EvalCase, EvalCaseWithLatestRun, EvalRunRecord, EvalRunResult } from "@devdigest/shared";

/** Round-to-percent formatter, e.g. 0.873 -> "87%" (mirrors the Eval
   Dashboard index's own `formatPercent` — kept as a small local duplicate
   rather than an import across route-private folders, per this codebase's
   existing ContextTab/SkillsTab colocation convention). */
export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** A dashboard `delta` is a raw 0..1 fraction difference (e.g. 0.05 = "+5
   percentage points") — scale it to the same percentage-point units the
   tile's own value is displayed in, for `MetricCard`'s `delta` prop. */
export function deltaPercentPoints(delta: number): number {
  return delta * 100;
}

/** Number of expectation items on a case — the row's "expected N" (the
   case's own `expected_output.length`, mirroring EvalCaseEditor/helpers.ts's
   `expectedCount`). */
export function expectedCount(evalCase: EvalCase): number {
  return Array.isArray(evalCase.expected_output) ? evalCase.expected_output.length : 0;
}

/** "got M" — how many GROUNDED findings a run's review call actually
   produced (server-side: `outcome.review.findings.length` — NOT `per_trace`'s
   own entry count, which is the number of expectation/extra ITEMS, not
   produced findings, and can differ from it in either direction).
   `executeOneCase` (server/src/modules/eval/service.ts) PREPENDS a synthetic,
   always-passing `__produced_count__` trace carrying this number as
   `{ produced: N }` specifically so the client can read it unambiguously —
   `per_trace[0]` is always this marker for any completed (non-error) run.
   `actual` may be either that marker's own `.actual` value directly (a
   caller passing `per_trace[0]?.actual`, e.g. `EvalsTab.tsx`'s own inline
   read) or the WHOLE `per_trace` array (a caller passing a persisted run's
   `actual_output`) — both shapes are handled. Mirrors
   EvalCaseEditor/helpers.ts's `countActual`, duplicated here per this
   codebase's route-private colocation convention. */
export function countActual(actual: unknown): number {
  if (Array.isArray(actual)) {
    const marker = actual.find(
      (entry) =>
        !!entry && typeof entry === "object" && (entry as { name?: unknown }).name === "__produced_count__",
    ) as { actual?: unknown } | undefined;
    return countActual(marker?.actual);
  }
  if (
    actual &&
    typeof actual === "object" &&
    typeof (actual as { produced?: unknown }).produced === "number"
  ) {
    return (actual as { produced: number }).produced;
  }
  return 0;
}

export interface RunFailureBreakdown {
  /** `must_find` expectations NOT matched by any produced finding. */
  missed: number;
  /** `must_not_flag` expectations that WERE matched — the agent flagged
     something it was explicitly told not to. */
  falsePositives: number;
  /** Produced findings backed by no expectation at all (noise). */
  extra: number;
}

/** Breaks down WHY a run failed, straight from `per_trace` — mirrors
   EvalCaseEditor/helpers.ts's `runFailureBreakdown`, duplicated here per this
   codebase's route-private colocation convention. Only FAILING entries count
   (a passing `must_not_flag` entry correctly means nothing was flagged). */
export function runFailureBreakdown(perTrace: unknown): RunFailureBreakdown {
  const entries = Array.isArray(perTrace) ? perTrace : [];
  const result: RunFailureBreakdown = { missed: 0, falsePositives: 0, extra: 0 };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const pass = (entry as { pass?: unknown }).pass;
    if (typeof name !== "string" || pass !== false) continue;
    if (name.startsWith("must_find ")) result.missed++;
    else if (name.startsWith("must_not_flag ")) result.falsePositives++;
    else if (name.startsWith("unexpected (")) result.extra++;
  }
  return result;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2, INFO: 3 };
const KNOWN_CATEGORIES = new Set(["bug", "security", "perf", "style", "test"]);

export interface CaseBadge {
  severity: Severity;
  category?: Category;
}

/**
 * A case's `expected_output` is an informal, unvalidated JSON array (each
 * item optionally carrying `severity`/`category`, mirroring the eval
 * module's server-internal `ExpectationItem`,
 * `server/src/modules/eval/types.ts`). When multiple items disagree on
 * severity, this shows the SINGLE highest-severity item present (CRITICAL >
 * WARNING > SUGGESTION > INFO — the `@devdigest/ui` `SEV` map's own key
 * order), a deliberate simplification over stacking every item's badge since
 * a case-list row has limited width. Items with no recognized `severity` are
 * ignored when picking; a case with zero recognized items renders no badge
 * at all (never a placeholder/default severity).
 */
export function highestSeverityBadge(expectedOutput: unknown): CaseBadge | null {
  if (!Array.isArray(expectedOutput)) return null;
  let best: CaseBadge | null = null;
  let bestRank = Infinity;
  for (const raw of expectedOutput) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const severity = typeof item.severity === "string" ? item.severity.toUpperCase() : undefined;
    const rank = severity ? SEVERITY_RANK[severity] : undefined;
    if (rank == null || rank >= bestRank) continue;
    const category =
      typeof item.category === "string" && KNOWN_CATEGORIES.has(item.category)
        ? (item.category as Category)
        : undefined;
    bestRank = rank;
    best = { severity: severity as Severity, category };
  }
  return best;
}

/** A case's pass/fail/never-run state: a fresh (this-session) run always
   wins over the case's own persisted `latest_run`, same fallback order as
   `EvalCaseEditor`'s status strip — extracted from `CaseRow` so the parent
   can aggregate a "X/Y passing" count without duplicating the fallback. */
export function casePassState(
  evalCase: EvalCaseWithLatestRun,
  result: EvalRunResult | undefined,
): boolean | null {
  if (result) return result.result.recall === 1 && result.result.precision === 1;
  return evalCase.latest_run ? evalCase.latest_run.pass : null;
}

/** Same ok/warn/crit tiering as the per-agent dashboard's own `passRateColor`
   (`EvalAgentDrillIn/helpers.ts`) — duplicated here per this codebase's
   route-private colocation convention. */
export function passRateColor(rate: number): string {
  if (rate >= 0.85) return "var(--ok)";
  if (rate >= 0.65) return "var(--warn)";
  return "var(--crit)";
}

/** The expectation type ("must_find" | "must_not_flag") to show as a badge
   on a case row — only when EVERY item in `expected_output` agrees on the
   same type (a case is usually homogeneous); a mixed or empty set renders no
   badge rather than guessing. */
export function caseExpectationType(evalCase: EvalCase): "must_find" | "must_not_flag" | null {
  if (!Array.isArray(evalCase.expected_output) || evalCase.expected_output.length === 0) return null;
  let type: "must_find" | "must_not_flag" | null = null;
  for (const raw of evalCase.expected_output) {
    if (!raw || typeof raw !== "object") return null;
    const t = (raw as Record<string, unknown>).type;
    if (t !== "must_find" && t !== "must_not_flag") return null;
    if (type === null) type = t;
    else if (type !== t) return null;
  }
  return type;
}

/** Converts a fresh (this-session) batch-run result into the `EvalRunRecord`
   shape `EvalCaseEditor`'s `latestRun` prop expects, so opening the editor
   right after an in-tab run shows its correct status strip immediately.
   `ran_at` has no real persisted value available here — this render's own
   timestamp is used as a reasonable stand-in; `pass` is derived the same way
   `computePass`/EvalCaseEditor's `stripDataFromResult` do (recall === 1 &&
   precision === 1), since a fresh `EvalRun` carries no top-level `pass`. */
export function toRunRecord(result: EvalRunResult, evalCase: EvalCase): EvalRunRecord {
  const run = result.result;
  return {
    id: result.run_id,
    case_id: result.case_id,
    case_name: evalCase.name,
    ran_at: new Date().toISOString(),
    actual_output: run.per_trace[0]?.actual ?? null,
    pass: run.recall === 1 && run.precision === 1,
    recall: run.recall,
    precision: run.precision,
    citation_accuracy: run.citation_accuracy,
    duration_ms: run.duration_ms,
    cost_usd: run.cost_usd,
  };
}
