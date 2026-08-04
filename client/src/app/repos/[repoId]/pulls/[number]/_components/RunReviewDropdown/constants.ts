/** Constants for RunReviewDropdown (the PR-page multi-agent picker). */

/** Picker panel width (px) — design source: components2.jsx `RunReviewDropdown`. */
export const PANEL_WIDTH = 288;

/** Agent-management route the `Configure agents…` footer links to. */
export const AGENTS_HREF = "/agents";

/** Result route for a launched multi-run (AC-32). */
export function multiRunHref(multiRunId: string): string {
  return `/multi-agent-review/${multiRunId}`;
}
