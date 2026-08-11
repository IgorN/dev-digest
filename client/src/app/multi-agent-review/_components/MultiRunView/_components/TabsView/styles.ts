/* Co-located styles for Tabs mode + the multi-agent finding card.
   Values taken verbatim from the design gallery's `TabsView`
   (design-src/screen_multiagent.jsx:67) and `FindingCard` (design-src/findings.jsx:62). */
import type { CSSProperties } from "react";

export const s = {
  tabBar: {
    display: "flex",
    gap: 2,
    padding: "0 28px",
    borderBottom: "1px solid var(--border)",
    overflowX: "auto",
  } satisfies CSSProperties,
  tab: (on: boolean, accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    background: "transparent",
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: on ? accent : "transparent",
    marginBottom: -1,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  tabName: (on: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: on ? 600 : 500,
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: (color: string): CSSProperties => ({ fontSize: 11, fontWeight: 700, color }),

  content: { padding: "20px 28px 0", maxWidth: 760 } satisfies CSSProperties,

  summaryCard: (accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 18,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: accent,
  }),
  summaryName: (accent: string): CSSProperties => ({ fontSize: 14, fontWeight: 600, color: accent }),
  summaryText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  summaryRight: {
    marginLeft: "auto",
    textAlign: "right",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "flex-end",
  } satisfies CSSProperties,
  summaryMeta: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  // ---- MultiAgentFindingCard ----
  card: (sevColor: string, muted: boolean): CSSProperties => ({
    borderRadius: 8,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
    borderStyle: "solid",
    // Disjoint longhands only: combining `borderColor` with `borderLeftColor`
    // makes React warn on every rerender (client/INSIGHTS.md 2026-07-30).
    borderTopColor: "var(--border)",
    borderRightColor: "var(--border)",
    borderBottomColor: "var(--border)",
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s",
  }),
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  cardMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  cardTitle: (muted: boolean): CSSProperties => ({
    fontSize: 13.5,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
  }),
  cardMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    marginTop: 2,
    flexShrink: 0,
  }),
  cardBody: {
    padding: "12px 14px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  prose: { fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" } satisfies CSSProperties,
  fixWrap: { marginTop: 12 } satisfies CSSProperties,
  fixLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 6,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 6,
    marginTop: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
};
