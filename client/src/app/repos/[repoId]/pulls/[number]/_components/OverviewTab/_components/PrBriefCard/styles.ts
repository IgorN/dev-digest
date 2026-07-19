import type { CSSProperties } from "react";

/** Co-located styles for PrBriefCard. Reuses the same visual language as the
   (post-restyle) IntentCard/BlastCard: a summary-style headerRow, bordered
   `--bg-elevated` rows for lists, and OnboardingView's degraded-banner /
   icon-badge shapes sized down for this card's row context. */
export const s = {
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  // --- what / why labeled text blocks (AC-14: two distinct, queryable regions) ---
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 14,
  } satisfies CSSProperties,
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  fieldText: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  // --- Risks / Review focus sub-sections ---
  section: { marginTop: 18 } satisfies CSSProperties,
  sectionHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  } satisfies CSSProperties,
  sectionLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  // AD-3: same type treatment as sectionLabel, inline with a leading icon —
  // used only by the Review Focus header so that block reads distinctly at
  // a glance (design-mockup parity), without changing the plain sectionLabel
  // the Risks header still uses.
  sectionLabelIcon: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyText: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,

  // --- Risk row: bordered, collapsible (mirrors BlastCard/SymbolRow's
  // symbolRow/symbolHeader shape); the icon-square mirrors OnboardingView's
  // iconBadge, sized down for a row rather than a section-card header. ---
  riskRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  riskRowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    background: "none",
    border: "none",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
  } satisfies CSSProperties,
  riskIconBadge: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: 6,
    flexShrink: 0,
  } satisfies CSSProperties,
  riskMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskFileRefs: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  riskExplanation: {
    margin: 0,
    padding: "8px 12px 10px 42px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  // --- Review-focus row: MonoLink (jump) + muted em-dash reason, same
  // bordered-row treatment as the risk rows / OnboardingView's pathRow. ---
  focusRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  focusReason: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // --- Degraded banner — mirrors OnboardingView/styles.ts's
  // degraded/degradedHead/degradedReason shape verbatim (colocated here
  // rather than imported across folders). No second "reason label" text:
  // this feature's badge text (t("degradedBadge")) IS the label, and
  // degraded_reason is server-composed free text (Rec-2), not an i18n key. ---
  degraded: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 18px",
    marginBottom: 16,
    borderRadius: 10,
    border: "1px solid var(--warn, var(--border))",
    background: "var(--warn-bg, var(--bg-hover))",
  } satisfies CSSProperties,
  degradedHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  degradedReason: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
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
