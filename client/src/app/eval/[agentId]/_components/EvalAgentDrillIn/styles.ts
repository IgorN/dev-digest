import type { CSSProperties } from "react";
import { TABLE_GRID_COLS } from "./constants";

/** Co-located styles for EvalAgentDrillIn. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13.5, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,

  alertBanner: { borderColor: "var(--warn)", marginBottom: 20 } satisfies CSSProperties,
  alertHeader: { display: "flex", alignItems: "flex-start", gap: 8 } satisfies CSSProperties,
  alertIcon: { color: "var(--warn)", marginTop: 1, flexShrink: 0 } satisfies CSSProperties,
  alertBody: { margin: 0, fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.5 } satisfies CSSProperties,

  tiles: { display: "flex", gap: 12, marginBottom: 20 } satisfies CSSProperties,

  section: { marginBottom: 24 } satisfies CSSProperties,

  table: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  tableHeadRow: {
    display: "grid",
    gridTemplateColumns: TABLE_GRID_COLS,
    gap: 10,
    padding: "0 14px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    alignItems: "center",
  } satisfies CSSProperties,
  tableRow: {
    display: "grid",
    gridTemplateColumns: TABLE_GRID_COLS,
    gap: 10,
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
    alignItems: "center",
  } satisfies CSSProperties,

  footer: { display: "flex", justifyContent: "flex-end", marginTop: 12 } satisfies CSSProperties,
} as const;
