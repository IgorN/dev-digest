import type { CSSProperties } from "react";

/** Co-located styles for OnboardingView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1120, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: {
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,

  // Two-column layout: sticky "On this page" ToC + the main sections column.
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 220px) 1fr",
    gap: 28,
    alignItems: "start",
  } satisfies CSSProperties,

  // --- Table of contents (scroll-spy) ---
  toc: { position: "sticky", top: 20, alignSelf: "start" } satisfies CSSProperties,
  tocLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  tocList: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  tocItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    borderTop: "none",
    borderRight: "none",
    borderBottom: "none",
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: "var(--border)",
    padding: "5px 0 5px 12px",
    // Longhand only: the `font` shorthand would both clobber fontSize/lineHeight
    // above AND collide with `tocItemActive`'s fontWeight on toggle (React warns
    // when a shorthand and its longhand are mixed across a rerender).
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.35,
    color: "var(--text-muted)",
    cursor: "pointer",
    transition: "color .12s, border-color .12s",
  } satisfies CSSProperties,
  tocItemActive: {
    borderLeftColor: "var(--accent-text)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,

  // --- Section cards ---
  sections: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "16px 20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
  } satisfies CSSProperties,
  iconBadge: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    color: "var(--accent-text)",
    background: "var(--accent-bg, var(--bg-hover))",
  } satisfies CSSProperties,
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0, display: "grid", placeItems: "center" } satisfies CSSProperties,
  cardBody: {
    padding: "0 20px 18px",
    fontSize: 13.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  diagram: { marginTop: 12 } satisfies CSSProperties,

  // --- Critical-paths rows ---
  rows: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  pathRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-base, transparent)",
  } satisfies CSSProperties,
  rowIcon: { color: "var(--text-muted)", flexShrink: 0, display: "grid", placeItems: "center" } satisfies CSSProperties,
  rowMain: { display: "flex", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" } satisfies CSSProperties,
  rowPath: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    color: "var(--text-primary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  rowDesc: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  rowAction: { flexShrink: 0 } satisfies CSSProperties,

  // --- Reading-path numbered rows ---
  readingRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-base, transparent)",
  } satisfies CSSProperties,
  numBadge: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: 99,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: "var(--accent)",
  } satisfies CSSProperties,
  readingText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } satisfies CSSProperties,
  readingPath: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    color: "var(--text-primary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  readingDesc: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 } satisfies CSSProperties,

  // --- Run-locally command rows ---
  prose: { marginBottom: 12 } satisfies CSSProperties,
  cmdRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 10px 8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-code, var(--bg-hover))",
  } satisfies CSSProperties,
  cmdNum: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
    width: 18,
    textAlign: "right",
  } satisfies CSSProperties,
  cmdText: {
    flex: 1,
    minWidth: 0,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    color: "var(--text-primary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,

  // --- First-tasks simple links ---
  links: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 16px",
    marginTop: 12,
  } satisfies CSSProperties,

  // --- Degraded / "Index unavailable" banner ---
  degraded: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 18px",
    marginBottom: 20,
    borderRadius: 10,
    border: "1px solid var(--warn, var(--border))",
    background: "var(--warn-bg, var(--bg-hover))",
  } satisfies CSSProperties,
  degradedHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  degradedLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  degradedReason: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
