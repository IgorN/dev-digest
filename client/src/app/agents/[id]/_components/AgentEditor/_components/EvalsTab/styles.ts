import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's Evals tab. */
export const s = {
  wrap: { maxWidth: 900, display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  header: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  h3: { fontSize: 15, fontWeight: 700, margin: "0 0 10px" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  scoringNote: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "-12px 0 0",
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  dashboardLink: {
    marginLeft: "auto",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 14 } satisfies CSSProperties,
  rowStatus: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  rowStatusLabel: { fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" } satisfies CSSProperties,
  rowMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  rowNameRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  rowName: {
    fontSize: 13.5,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  rowTypeBadge: { flexShrink: 0, textTransform: "uppercase" } satisfies CSSProperties,
  rowSubtitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
} as const;
