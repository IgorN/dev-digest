/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Injected context-doc status → badge colours (Configuration section). */
export const SPEC_STATUS_COLORS = {
  injected: { color: "var(--ok)", bg: "var(--ok-bg)" },
  truncated: { color: "var(--warn)", bg: "var(--warn-bg)" },
  skipped_missing: { color: "var(--crit)", bg: "var(--crit-bg)" },
} as const;

/** Prompt-assembly block accent colours (by leg). */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;
