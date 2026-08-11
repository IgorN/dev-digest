/* Formatters + palette lookup shared by every Multi-Agent Review surface. */
import { formatCost } from "@/lib/cost";
import { AGENT_ACCENTS, AGENT_ACCENT_FALLBACK } from "./constants";

/** AC-52 — positional accent, neutral grey past the fourth lane. */
export function accentForIndex(index: number): string {
  return AGENT_ACCENTS[index] ?? AGENT_ACCENT_FALLBACK;
}

/**
 * `8.2s` — the design's one-decimal seconds. `—` when the metric is absent, so
 * a history-less agent never reads as `0s` (AC-27, AC-31).
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * `$0.06` — two decimals, which is what the design and AC-30's worked example
 * (`≈ 8.2s · $0.20 · parallel fan-out`) both spell out. Deliberately NOT
 * `@/lib/cost`'s `formatCost` for the normal range: that one renders 3 decimals
 * below $1 (`$0.060`), which is right for a run-cost badge but breaks the
 * aggregate's stated observable. Sub-cent values still defer to it, so a real
 * $0.0007 run never collapses into a misleading `$0.00`.
 * `—` when absent (AC-27, AC-31) — never a fabricated zero.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd > 0 && usd < 0.01) return formatCost(usd);
  return `$${usd.toFixed(2)}`;
}
