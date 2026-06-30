import type { CSSProperties } from "react";

/** Co-located styles for SkillPreviewDrawer. */
export const s = {
  body: { padding: 24, overflow: "auto" } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 18 } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  markdown: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 16px",
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 14, justifyContent: "flex-end" } satisfies CSSProperties,
  enabledLabel: {
    marginRight: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
