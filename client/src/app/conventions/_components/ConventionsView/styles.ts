import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1080, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 6 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)", fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  toolbar: { display: "flex", gap: 10, alignItems: "center", margin: "18px 0 16px" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  empty: { paddingTop: 40 } satisfies CSSProperties,
} as const;
