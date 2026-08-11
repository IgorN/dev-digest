import type { CSSProperties } from "react";
import { DIFF_PANEL_MAX_HEIGHT } from "./constants";

/** Co-located styles for CompareRunsModal. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 20, padding: "18px 24px" } satisfies CSSProperties,

  deltaGrid: { display: "flex", gap: 12 } satisfies CSSProperties,
  deltaTile: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  deltaLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  deltaRow: { display: "flex", alignItems: "baseline", gap: 8 } satisfies CSSProperties,
  deltaValue: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  deltaIndicator: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,

  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,

  noChange: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 13.5,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  diffPanel: {
    maxHeight: DIFF_PANEL_MAX_HEIGHT,
    overflowY: "auto",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  diffLine: {
    display: "flex",
    padding: "1px 12px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  diffSign: { width: 16, flexShrink: 0, userSelect: "none" } satisfies CSSProperties,

  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;

/** Diff row background/text color per line kind — reuses the same
   `--code-add`/`--code-del` tokens the PR diff viewer uses (client/src/components/diff-viewer/styles.ts). */
export function diffLineStyleFor(kind: "added" | "removed" | "unchanged") {
  if (kind === "added") return { background: "var(--code-add)", color: "var(--code-add-text)" };
  if (kind === "removed") return { background: "var(--code-del)", color: "var(--code-del-text)" };
  return { background: "transparent", color: "var(--text-primary)" };
}

export function diffSignFor(kind: "added" | "removed" | "unchanged"): string {
  return kind === "added" ? "+" : kind === "removed" ? "−" : " ";
}
