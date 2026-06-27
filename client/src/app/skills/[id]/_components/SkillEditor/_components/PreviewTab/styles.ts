import type { CSSProperties } from "react";

/** Co-located styles for the skill editor's Preview tab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 } satisfies CSSProperties,
  block: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  blockLabel: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
    padding: "8px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  markdown: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    padding: "16px 20px",
  } satisfies CSSProperties,
} as const;
