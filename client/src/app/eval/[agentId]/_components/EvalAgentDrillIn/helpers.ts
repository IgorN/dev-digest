/* helpers.ts — pure formatting + state-machine logic for the per-agent Eval
   Dashboard drill-in. No I/O, no React — safe to unit test directly. */
import type { ChartSeries } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { COMPARE_SELECTION_SIZE } from "./constants";

/** Round-to-percent formatter, e.g. 0.873 -> "87%". */
export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "vN" version tag. */
export function formatVersion(version: number): string {
  return `v${version}`;
}

/** Short date, mirrors the codebase's `toLocaleDateString()` convention
   (also used by EvalDashboardIndex's `formatDate`). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export type DeltaDirection = "up" | "down" | "flat";

export function deltaDirection(delta: number): DeltaDirection {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

/** Delta color — green for improvement, red for regression, muted for flat.
   Never color-alone in the surrounding markup (an ArrowUp/ArrowDown/Slash
   icon always accompanies it) per this codebase's accessibility convention. */
export function deltaColor(delta: number): string {
  const dir = deltaDirection(delta);
  return dir === "flat" ? "var(--text-muted)" : dir === "up" ? "var(--ok)" : "var(--crit)";
}

/** "+5pts" / "-2pts" / "0pt" — deltas are already point-scale fractions
   (0.05 == 5 percentage points), matching dashboard.current's own 0..1 scale. */
export function formatDeltaPoints(delta: number): string {
  const pts = Math.round(delta * 100);
  const sign = pts > 0 ? "+" : pts < 0 ? "-" : "";
  return `${sign}${Math.abs(pts)}pt${Math.abs(pts) === 1 ? "" : "s"}`;
}

/**
 * Pass-rate color tier for the Recent Runs table's PASS cell. `EvalTrendPoint`
 * (the historical per-batch shape) carries only a 0..1 `pass_rate` — there is
 * no per-batch "N/M" count on it (that exact count only exists for the
 * dashboard's CURRENT batch, via `dashboard.current.traces_passed` /
 * `traces_total`, already shown in the metric tiles). So each historical row
 * renders a colored percentage rather than a fraction. Thresholds mirror
 * `ConfidenceNum`'s existing convention (>=85 ok, >=65 warn, else crit).
 * Evidence: src/vendor/ui/primitives/ConfidenceNum.tsx.
 */
export function passRateColor(rate: number): string {
  if (rate >= 0.85) return "var(--ok)";
  if (rate >= 0.65) return "var(--warn)";
  return "var(--crit)";
}

/**
 * Metric-trend chart series — `dashboard.trend` is chronological (oldest
 * first per the contract), fed straight into `LineChart` with no reordering.
 * Colors are fixed per metric (accent/ok/warn) so the same metric always
 * reads as the same color across the trend chart AND the metric tiles'
 * sparklines (see `tileTrend`/`TILE_COLOR`).
 */
export function toChartSeries(
  trend: EvalTrendPoint[],
  labels: { recall: string; precision: string; citation: string },
): ChartSeries[] {
  return [
    { name: labels.recall, color: "var(--accent)", data: trend.map((p) => p.recall) },
    { name: labels.precision, color: "var(--ok)", data: trend.map((p) => p.precision) },
    { name: labels.citation, color: "var(--warn)", data: trend.map((p) => p.citation_accuracy) },
  ];
}

/** Per-metric trend series for a tile's Sparkline — same source array
   (`dashboard.trend`) the LineChart uses, sliced to one metric's numbers. */
export function tileTrend(
  trend: EvalTrendPoint[],
  key: "recall" | "precision" | "citation_accuracy",
): number[] {
  return trend.map((p) => p[key]);
}

/**
 * Recent-runs checkbox selection state machine (AC-35): re-clicking an
 * already-selected run deselects it; selecting while fewer than
 * `COMPARE_SELECTION_SIZE` are selected appends; selecting past the cap drops
 * the OLDEST-selected entry (index 0 — the first one checked) and appends the
 * new one, so the invariant "at most N selected, and they're always the N
 * most recently checked" always holds.
 */
export function toggleRunSelection(selected: string[], runId: string): string[] {
  if (selected.includes(runId)) {
    return selected.filter((id) => id !== runId);
  }
  if (selected.length < COMPARE_SELECTION_SIZE) {
    return [...selected, runId];
  }
  return [...selected.slice(1), runId];
}
