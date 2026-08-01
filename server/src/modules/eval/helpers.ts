import type { EvalRun, EvalTrendPoint, Finding, UnifiedDiff } from '@devdigest/shared';
import type { ExpectationItem } from './types.js';

/**
 * Eval helpers — pure, zero-I/O functions supporting the "case from finding"
 * flow (AC-1/AC-2/AC-5), disposition tie-breaking, trend aggregation, and the
 * deterministic "most notable movement" alert (AC-34). None of these call an
 * LLM or any adapter; every input is already-in-memory data.
 */

/**
 * Restrict a parsed `UnifiedDiff` to only the hunks/file entry belonging to
 * `file` (AC-5 — a case created from a finding stores a diff scoped to JUST
 * that finding's file, not the whole PR's diff).
 *
 * `DiffHunk` (`src/adapters/git/diff-parser.ts`) does not retain the raw
 * hunk body text, only line-number metadata — so `raw` can't be rebuilt from
 * `files` alone. Instead this re-slices the ORIGINAL raw text by the same
 * `diff --git` / `+++ b/<path>` boundaries `parseUnifiedDiff` itself uses,
 * so the result is a standalone, independently re-parseable unified-diff
 * snippet for exactly one file.
 */
export function sliceDiffForFile(diff: UnifiedDiff, file: string): UnifiedDiff {
  const matchedFile = diff.files.find((f) => f.path === file);
  const files = matchedFile ? [matchedFile] : [];
  const raw = extractFileSection(diff.raw, file);
  return { raw, files };
}

/** Splits `raw` into per-file `diff --git ...` sections and returns the one for `file`. */
function extractFileSection(raw: string, file: string): string {
  const lines = raw.split('\n');
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (current) sections.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current);

  const match = sections.find((section) =>
    section.some((l) => l.startsWith('+++ ') && l.slice(4).replace(/^b\//, '').trim() === file),
  );
  return match ? match.join('\n') : '';
}

/**
 * Build the single `ExpectationItem` a "turn finding into eval case" action
 * produces (AC-1/AC-2): `must_find` for an accepted finding, `must_not_flag`
 * for a dismissed one. `Finding` already carries both `start_line`/`end_line`
 * as required ints (`src/vendor/shared/contracts/findings.ts`), so both are
 * copied directly — no single-line fallback is needed.
 */
export function buildExpectationFromFinding(
  finding: Finding,
  disposition: 'accepted' | 'dismissed',
): ExpectationItem[] {
  const item: ExpectationItem = {
    type: disposition === 'accepted' ? 'must_find' : 'must_not_flag',
    file: finding.file,
    start_line: finding.start_line,
    end_line: finding.end_line,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
  };
  return [item];
}

/**
 * Resolve a finding's disposition from its `accepted_at`/`dismissed_at`
 * timestamps: `'pending'` when both are null; otherwise the LATER timestamp
 * wins. On an exact tie (identical timestamps, both set), `'accepted'` wins —
 * an arbitrary but deterministic tie-break; ties are not expected in practice
 * since both columns can't be written by the same action.
 */
export function resolveDisposition(
  acceptedAt: Date | string | null,
  dismissedAt: Date | string | null,
): 'accepted' | 'dismissed' | 'pending' {
  const acceptedMs = acceptedAt !== null ? new Date(acceptedAt).getTime() : null;
  const dismissedMs = dismissedAt !== null ? new Date(dismissedAt).getTime() : null;

  if (acceptedMs === null && dismissedMs === null) return 'pending';
  if (acceptedMs === null) return 'dismissed';
  if (dismissedMs === null) return 'accepted';
  return dismissedMs > acceptedMs ? 'dismissed' : 'accepted';
}

const METRIC_KEYS = ['recall', 'precision', 'citation_accuracy'] as const;
type NotableMetric = (typeof METRIC_KEYS)[number];

const METRIC_LABELS: Record<NotableMetric, string> = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation accuracy',
};

/**
 * AC-34: pick the metric (recall/precision/citation_accuracy) with the
 * largest absolute signed delta between the two most recent trend points;
 * `null` when fewer than two batches exist (`previous` undefined). `message`
 * is built by PLAIN STRING INTERPOLATION only — this function makes zero
 * LLM/model calls (no `container`/`LLMProvider` parameter at all, no import
 * of any LLM provider type — verifiable from this function's own signature
 * and imports, not merely by grepping identifiers, which can false-positive
 * on an explanatory comment; server/INSIGHTS.md, 2026-07-12).
 */
export function selectNotableMetric(
  latest: EvalTrendPoint,
  previous: EvalTrendPoint | undefined,
): { metric: NotableMetric; delta: number; message: string } | null {
  if (!previous) return null;

  let metric: NotableMetric = 'recall';
  let delta = latest.recall - previous.recall;
  for (const key of METRIC_KEYS.slice(1)) {
    const candidate = latest[key] - previous[key];
    if (Math.abs(candidate) > Math.abs(delta)) {
      metric = key;
      delta = candidate;
    }
  }

  const direction = delta >= 0 ? 'improved' : 'dropped';
  const points = Math.abs(delta * 100).toFixed(0);
  const message = `${METRIC_LABELS[metric]} ${direction} ${points}pts on v${latest.agent_version}`;

  return { metric, delta, message };
}

/**
 * Aggregate one batch's per-case `EvalRun` results into a single
 * `EvalTrendPoint`: mean recall/precision/citation_accuracy, `pass_rate`, and
 * a null-safe summed `cost_usd`.
 *
 * Interface decision: `runs` is one `EvalRun` per targeted case in the batch
 * (the shape `service.ts`/T11 already produces per case via `scoring.ts`).
 * `EvalRun` has no single top-level "did this case pass" boolean — only
 * `traces_passed`/`traces_total` (aggregated from `per_trace`, `{name, pass,
 * expected, actual}`). A case-run counts as "passed" for `pass_rate` when
 * ALL of its traces passed (`traces_passed === traces_total`); a run with
 * `traces_total === 0` is treated as vacuously passed (mirrors the "1.0 when
 * zero applicable items" convention used throughout `scoring.ts`). `pass_rate`
 * is then the fraction of runs that passed, not a raw trace-level ratio.
 */
export function buildTrendPoint(
  runBatchId: string,
  agentVersion: number,
  ranAt: string,
  runs: EvalRun[],
): EvalTrendPoint {
  const total = runs.length;

  if (total === 0) {
    return {
      run_id: runBatchId,
      agent_version: agentVersion,
      ran_at: ranAt,
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      pass_rate: 0,
      cost_usd: null,
    };
  }

  const sumOf = (pick: (run: EvalRun) => number) =>
    runs.reduce((acc, run) => acc + pick(run), 0);

  const recall = sumOf((run) => run.recall) / total;
  const precision = sumOf((run) => run.precision) / total;
  const citationAccuracy = sumOf((run) => run.citation_accuracy) / total;

  const passedCount = runs.filter(
    (run) => run.traces_total === 0 || run.traces_passed === run.traces_total,
  ).length;
  const passRate = passedCount / total;

  const costs = runs
    .map((run) => run.cost_usd)
    .filter((cost): cost is number => cost !== null);
  const costUsd = costs.length > 0 ? costs.reduce((acc, cost) => acc + cost, 0) : null;

  return {
    run_id: runBatchId,
    agent_version: agentVersion,
    ran_at: ranAt,
    recall,
    precision,
    citation_accuracy: citationAccuracy,
    pass_rate: passRate,
    cost_usd: costUsd,
  };
}
