/**
 * Single source of truth for rendering a USD run cost. Used by RunCostBadge
 * (PR list / timeline / accordion) AND the trace-drawer Stats tile so the same
 * number never reads two different ways.
 *
 * - `null`/`undefined` → "—" (unknown — a run with no usage data)
 * - a real `0`         → "$0.00" (distinct from unknown)
 * - sub-cent           → 4 decimals ("$0.0007", "$0.0011")
 * - < $1               → 3 decimals ("$0.012", "$0.140")
 * - ≥ $1               → 2 decimals ("$1.23")
 *
 * Never scientific notation — "$7.3e-4" is unreadable in a table cell.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
