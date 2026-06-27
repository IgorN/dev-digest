import type { CSSProperties } from "react";

/** Co-located styles for the skill editor's Stats tab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  metric: { display: "flex", alignItems: "baseline", gap: 10 } satisfies CSSProperties,
  metricNum: { fontSize: 32, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  metricLabel: { fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 600, flex: 1, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
