import type { CSSProperties } from "react";

export const s = {
  /** Intent | Blast radius side by side (matches the design's two-column
     Overview layout); stacks on narrow viewports since the page's own
     content column is already width-capped, not the grid itself. */
  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
