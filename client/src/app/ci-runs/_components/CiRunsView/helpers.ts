/* helpers.ts — pure formatting + derivation for the CI Runs table.
   No I/O, no React — directly unit-testable.

   Everything a row renders is a SNAPSHOT taken from someone else's CI (the
   agent name, the PR title, the source label). These helpers only ever return
   plain strings for React to escape — nothing here builds markup or a URL. */

import type { CiRun, CiRunStatus } from "@devdigest/shared";
import type { CiRunsFilters } from "@/lib/hooks/ci-runs";
import { FINDING_SEVERITIES, STATUS_META } from "./constants";

/** `2026-06-01 08:42`, the design's timestamp shape. `—` when unknown. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `7.4s`. Unknown duration renders `—`, never `0s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  return `${Math.round(seconds * 10) / 10}s`;
}

/**
 * The non-zero severity pairs the findings cell renders. An empty array means
 * the cell shows `—` — a zero-finding run must never read as `0` (AC-48).
 */
export function findingBreakdown(
  run: Pick<CiRun, "critical" | "warning" | "suggestion">,
): { severity: (typeof FINDING_SEVERITIES)[number]; count: number }[] {
  const byKey = {
    CRITICAL: run.critical,
    WARNING: run.warning,
    SUGGESTION: run.suggestion,
  } as const;
  return FINDING_SEVERITIES.flatMap((severity) => {
    const count = byKey[severity];
    return count != null && count > 0 ? [{ severity, count }] : [];
  });
}

/** Palette + message key for a known status; `null` for anything unrecognised. */
export function statusMeta(status: string | null | undefined) {
  if (!status) return null;
  return STATUS_META[status as CiRunStatus] ?? null;
}

/**
 * Source options for the source chip. `CiRunsResponse` carries agent and repo
 * facets but not sources (only GitHub Actions exists this iteration), so they
 * are derived from the loaded rows — union'd with the active selection so a
 * narrowed result set can never drop the option that produced it.
 */
export function sourceOptions(runs: CiRun[], selected: string | null | undefined): string[] {
  const set = new Set<string>();
  for (const r of runs) if (r.source) set.add(r.source);
  if (selected) set.add(selected);
  return [...set].sort();
}

/** True when any chip constrains the list — distinguishes "no runs at all"
   (the empty state, AC-53) from "no runs match these filters". */
export function hasActiveFilters(filters: CiRunsFilters): boolean {
  return Boolean(filters.days ?? filters.agent_id ?? filters.repo ?? filters.status ?? filters.source);
}
