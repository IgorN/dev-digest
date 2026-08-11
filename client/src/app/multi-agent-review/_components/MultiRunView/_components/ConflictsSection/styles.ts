/* Co-located styles for the "Where agents disagree" block.
   Values taken verbatim from the design gallery's `ConflictsSection`
   (design-src/screen_multiagent.jsx:21) — its `t.note`-on-every-cell rendering
   is deliberately NOT ported (see ConflictsSection.tsx). */
import type { CSSProperties } from "react";

export const s = {
  wrap: { marginTop: 22 } satisfies CSSProperties,
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  groupLocation: { fontSize: 12 } satisfies CSSProperties,
  groupLabel: { fontSize: 13, fontWeight: 600, marginLeft: 6 } satisfies CSSProperties,

  // 1px gap over a --border background renders as hairline cell dividers.
  groupBody: (cells: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${cells}, 1fr)`,
    gap: 1,
    background: "var(--border)",
  }),
  cell: { padding: "10px 14px", background: "var(--bg-elevated)" } satisfies CSSProperties,
  cellAgent: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  verdictRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  verdictText: (flagged: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: flagged ? "var(--text-primary)" : "var(--text-muted)",
    textTransform: flagged ? "uppercase" : "none",
    letterSpacing: flagged ? "0.03em" : 0,
  }),
  rationale: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
};
