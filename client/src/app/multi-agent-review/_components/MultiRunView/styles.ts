/* Co-located styles for the multi-run result shell.
   Values taken verbatim from the design gallery's `ScreenMultiAgent` toolbar
   (design-src/screen_multiagent.jsx:167-176) and `MetaRow` (:42). */
import type { CSSProperties } from "react";

export const s = {
  toolbar: {
    padding: "18px 28px 4px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  configureBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  selectedAgents: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  segmented: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  segment: (on: boolean): CSSProperties => ({
    padding: "4px 12px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    background: on ? "var(--bg-elevated)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-muted)",
  }),

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 28px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  metaNumber: { color: "var(--text-muted)" } satisfies CSSProperties,
  metaTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  metaSummary: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  conflictsWrap: { padding: "0 28px 40px" } satisfies CSSProperties,
  loading: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
};
