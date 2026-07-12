import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer + its RoleGroup/SplitSuggestionBanner. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  empty: {
    padding: "24px",
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  groupHeaderToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    padding: "6px 2px",
  } satisfies CSSProperties,
  groupIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  groupLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupChevron: { marginLeft: "auto", color: "var(--text-muted)" } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  bannerHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px" } satisfies CSSProperties,
  splitList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    paddingLeft: 18,
  } satisfies CSSProperties,
  splitItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 } satisfies CSSProperties,
  splitName: { color: "var(--text-primary)", fontWeight: 500 } satisfies CSSProperties,
  splitCount: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the (boilerplate) group section is open —
   mirrors FileCard's own chevronFor, kept as a local copy rather than
   reaching into diff-viewer/styles.ts for one rotation rule. */
export function groupChevronStyle(open: boolean): CSSProperties {
  return {
    ...s.groupChevron,
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
