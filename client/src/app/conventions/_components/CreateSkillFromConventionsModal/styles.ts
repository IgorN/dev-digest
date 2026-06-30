import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillFromConventionsModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 4, overflow: "auto" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--accent-bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
  } satisfies CSSProperties,
  row: { display: "flex", gap: 16, alignItems: "flex-start" } satisfies CSSProperties,
  tokens: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" } satisfies CSSProperties,
  footerNote: { marginRight: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
