/* Co-located styles for Columns mode.
   Values taken verbatim from the design gallery's `ColumnsView` (:52),
   `AgentColHeader` (:12) and `AgentFindingMini` (:3). */
import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "20px 28px 0" } satisfies CSSProperties,
  grid: (cols: number, scroll: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`,
    gap: 12,
    overflowX: scroll ? "auto" : "visible",
  }),
  column: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } satisfies CSSProperties,
  // Longhand top border on purpose: a `border-top: 2px solid var(--x)`
  // shorthand is dropped by jsdom's CSS parser, which makes the positional
  // accent unassertable in tests (and mixing shorthand + longhand makes React
  // warn — client/INSIGHTS.md 2026-07-30).
  columnHeader: (accent: string): CSSProperties => ({
    padding: 12,
    borderBottom: "1px solid var(--border)",
    borderTopWidth: 2,
    borderTopStyle: "solid",
    borderTopColor: accent,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 9 } satisfies CSSProperties,
  headerIcon: (accent: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: accent + "1f",
    color: accent,
    flexShrink: 0,
  }),
  headerMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  headerNameRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } satisfies CSSProperties,
  headerName: {
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  headerStatus: (color: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color,
    flexShrink: 0,
  }),
  headerMeta: { fontSize: 10.5, color: "var(--text-muted)" } satisfies CSSProperties,
  scorePlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 99,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    flexShrink: 0,
  } satisfies CSSProperties,

  body: {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    flex: 1,
  } satisfies CSSProperties,
  bodyEmpty: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  finding: (sevColor: string): CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    borderLeft: "2px solid " + sevColor,
  }),
  findingTitleRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  findingTitle: {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.3,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  findingFile: { fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,

  footer: {
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  footerCount: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
};
