import type { CSSProperties } from "react";

/** Co-located styles for the shared EvalCaseEditor modal. */
export const s = {
  body: { padding: "20px 24px", display: "flex", flexDirection: "column" } satisfies CSSProperties,
  tabPanel: { marginTop: 10 } satisfies CSSProperties,
  readonlyPre: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.55,
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  skeletonRow: { display: "flex", justifyContent: "flex-end", marginTop: 8 } satisfies CSSProperties,
  footer: { display: "flex", flexDirection: "column", gap: 12, width: "100%" } satisfies CSSProperties,
  strip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stripDetail: { color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
