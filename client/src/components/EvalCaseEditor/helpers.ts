/* Pure helpers for EvalCaseEditor — JSON validation/authoring for
   `expected_output` and the "Last run" status-strip data derivation.
   Zero I/O; the component owns all data fetching via lib/hooks/eval. */
import type { EvalCase, EvalRun, EvalRunRecord, EvalRunResult } from "@devdigest/shared";

export interface ParsedExpectedOutput {
  valid: boolean;
  value: unknown[] | null;
}

/**
 * Live-parses the Expected-output textarea's raw JSON text. `expected_output`
 * is `z.unknown()` server-side — "is a JSON array" is the only enforced
 * shape (per the eval module's own internal `ExpectationItem` note) — so
 * "valid" here means "parses AND is an array", gating Save (AC-7). An empty
 * textarea is treated as a valid empty array rather than an error, so a
 * brand-new case doesn't open already invalid.
 */
export function parseExpectedOutput(text: string): ParsedExpectedOutput {
  const trimmed = text.trim();
  if (trimmed === "") return { valid: true, value: [] };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { valid: false, value: null };
    return { valid: true, value: parsed };
  } catch {
    return { valid: false, value: null };
  }
}

/**
 * Appends one skeleton expectation item to the current JSON text. Tolerant
 * of currently-invalid/empty text — starts a fresh single-item array rather
 * than refusing to help just because the user's in-progress edit doesn't
 * parse yet.
 */
export function appendFindingSkeleton(text: string, skeleton: Record<string, unknown>): string {
  const parsed = parseExpectedOutput(text);
  const next = [...(parsed.value ?? []), skeleton];
  return JSON.stringify(next, null, 2);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Number of expectation items on a case — the strip's "expected N" (per the
   spec: the CASE's own `expected_output.length`, not a run's own snapshot of
   it, which may be stale relative to an in-progress edit). */
export function expectedCount(evalCase: EvalCase | null | undefined): number {
  return Array.isArray(evalCase?.expected_output) ? evalCase.expected_output.length : 0;
}

/**
 * "got M" — how many GROUNDED findings the run's review call actually
 * produced (server-side: `outcome.review.findings.length`, the same value
 * `scoring.ts`'s `computeRecall`/`computePrecision` operate over — NOT a
 * count reconstructed from `per_trace`'s own entry count, which is the
 * number of expectation/extra ITEMS, not produced findings, and can differ
 * from it in either direction).
 *
 * `executeOneCase` (server/src/modules/eval/service.ts) PREPENDS a synthetic,
 * always-passing `__produced_count__` trace carrying this number as
 * `{ produced: N }` specifically so the client can read it unambiguously —
 * `per_trace[0]` is always this marker for any completed (non-error) run.
 * `actual` here may be either that marker's own `.actual` value directly
 * (a caller passing `per_trace[0]?.actual`) or the WHOLE `per_trace` array (a
 * caller passing a persisted run's `actual_output`, which stores the full
 * array) — both shapes are handled so this stays correct either way.
 * Anything else (missing/malformed/an error run's `per_trace`, which carries
 * no marker) counts as 0.
 */
function countActual(actual: unknown): number {
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

/**
 * Breaks down WHY a run failed, straight from the `per_trace` array the run
 * already returns — no extra server call or DB access. `executeOneCase`
 * (server/src/modules/eval/service.ts) names each trace entry by a fixed
 * prefix: `` `${type} ${file}:${line}` `` for an expectation trace (`type` is
 * `must_find`/`must_not_flag`) and `` `unexpected (${tag}) ${file}:${line}` ``
 * for an unbacked extra — only FAILING entries count here (a passing
 * `must_not_flag` entry correctly means nothing was flagged, not a miss).
 */
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

export interface RunStripData {
  pass: boolean;
  expected: number;
  got: number;
  durationMs: number | null;
  costUsd: number | null;
  breakdown: RunFailureBreakdown;
}

/** Status-strip data from a PERSISTED run record (e.g. passed in by a caller
   that already knows the case's latest run, such as the Evals tab's case
   list). */
export function stripDataFromRecord(
  record: EvalRunRecord,
  currentCase: EvalCase | null | undefined,
): RunStripData {
  return {
    pass: !!record.pass,
    expected: expectedCount(currentCase),
    got: countActual(record.actual_output),
    durationMs: record.duration_ms,
    costUsd: record.cost_usd,
    breakdown: runFailureBreakdown(record.actual_output),
  };
}

/** Status-strip data from a FRESH batch-run result (this session's own "Run
   case" / "run on save"), scoped to one case. `EvalRun` (unlike
   `EvalRunRecord`) has no top-level `pass` field, so it's derived the same
   way `computePass` does server-side: recall === 1 && precision === 1. */
export function stripDataFromResult(result: EvalRunResult, expected: number): RunStripData {
  const run: EvalRun = result.result;
  return {
    pass: run.recall === 1 && run.precision === 1,
    expected,
    got: countActual(run.per_trace[0]?.actual),
    durationMs: run.duration_ms,
    costUsd: run.cost_usd,
    breakdown: runFailureBreakdown(run.per_trace),
  };
}
