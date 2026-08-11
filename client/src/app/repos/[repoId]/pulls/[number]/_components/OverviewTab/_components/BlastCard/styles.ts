import type { CSSProperties } from "react";

/** Co-located styles for BlastCard. Mirrors IntentCard's summary/headerRow
   look; the symbol tree borrows FileCard's collapsible-row visual language
   (chevron + mono path + subtle hover) so it reads as the same family of
   component as the rest of the PR detail page. */
export const s = {
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 4,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statCount: {
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    fontStyle: "italic",
    borderLeft: "3px solid var(--border-strong)",
    paddingLeft: 12,
    margin: "0 0 16px",
  } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  noDownstream: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "8px 0",
  } satisfies CSSProperties,
  symbolRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,
  symbolName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolKind: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolCallerCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "4px 12px 12px 34px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  // Bordered-row treatment mirroring OnboardingView/styles.ts's `pathRow` —
  // same border/radius/background shape, colocated here rather than imported
  // across folders. Subtle background differentiation from the parent
  // `symbolBody` (which has no background of its own, inheriting
  // `symbolRow`'s `--bg-elevated`).
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-base, transparent)",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-secondary)",
    font: "inherit",
  } satisfies CSSProperties,
  callerName: {
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  callerLoc: {
    fontSize: 12,
    color: "var(--info)",
  } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  emptyCallers: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "2px 0",
  } satisfies CSSProperties,
} as const;

export function chevronStyle(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}
