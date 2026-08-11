/* constants.ts — CI Runs table geometry + column identity.

   GRID and COLUMN_KEYS must stay aligned with each other AND with the
   `ci.runs.table.*` message keys, exactly like the PR-list table's
   GRID/COLUMN_KEYS pair (client/INSIGHTS.md, 2026-06-19): adding a column means
   touching all three or the header and the cells silently misalign. */

import type { CiRunStatus } from "@devdigest/shared";

/** The design's nine-column grid (screen_cizruns.jsx:36). */
export const GRID = "140px 1fr 150px 130px 70px 110px 70px 110px 80px";

/**
 * Header labels, in the design's order. The ninth column is the trailing action
 * cell, which the design renders with an empty header — `null` marks it so the
 * header row still emits nine cells and stays in step with the body rows.
 */
export const COLUMN_KEYS = [
  "timestamp",
  "pullRequest",
  "agent",
  "source",
  "duration",
  "findings",
  "cost",
  "status",
  null,
] as const;

/** Severity columns of the findings cell, in the design's order. */
export const FINDING_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

/**
 * Status pill palette. `no_findings` is deliberately neutral (a clean review is
 * not a failure and not a celebration), `running` uses the accent so an
 * in-flight run reads as "not settled yet" rather than as an outcome.
 * Every state is ALSO conveyed by its text label (WCAG 2.1 AA — never colour
 * alone), which is why `messageKey` exists alongside the colours.
 */
export const STATUS_META: Record<CiRunStatus, { color: string; bg: string; messageKey: string }> = {
  succeeded: { color: "var(--ok)", bg: "var(--ok-bg)", messageKey: "succeeded" },
  no_findings: { color: "var(--text-secondary)", bg: "var(--bg-hover)", messageKey: "noFindings" },
  // Warn, not crit: the gate firing is the feature working. It must still be
  // visibly NOT green — the linked GitHub check is red and the merge is stopped.
  blocked: { color: "var(--warn)", bg: "var(--warn-bg)", messageKey: "blocked" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)", messageKey: "failed" },
  running: { color: "var(--accent)", bg: "var(--accent-bg)", messageKey: "running" },
};

/** The statuses the status chip offers, in the design's reading order. */
export const STATUS_OPTIONS: CiRunStatus[] = [
  "succeeded",
  "no_findings",
  "blocked",
  "failed",
  "running",
];

/**
 * The date-range chip is a single toggle rather than a picker: the frozen `ci`
 * namespace ships exactly one range label (`filters.last7Days`), so offering
 * "30 days"/"all time" would require inventing copy this slice may not add.
 */
export const DATE_RANGE_DAYS = 7;

/** Where the empty state's call to action leads — CI starts on an agent. */
export const EMPTY_CTA_HREF = "/agents";
