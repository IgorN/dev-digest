import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. No existing two-column list primitive
   exists in this codebase (per the Intent Layer plan) — a small local
   grid layout for the In scope / Out of scope lists. */
export const s = {
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    fontStyle: "italic",
    borderLeft: "3px solid var(--border-strong)",
    paddingLeft: 12,
    margin: "0 0 16px",
  } satisfies CSSProperties,
  lists: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  } satisfies CSSProperties,
  listCol: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  listItem: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  listItemDot: {
    flexShrink: 0,
    marginTop: 6,
  } satisfies CSSProperties,
  emptyList: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 12,
  } satisfies CSSProperties,
} as const;
