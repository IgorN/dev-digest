/* Co-located styles for ConfigureRunView + AgentPickCard.
   Values taken verbatim from the design gallery's `RunConfig` (:107) and
   `PersonaPickCard` (:93) in design-src/screen_multiagent.jsx. */
import type { CSSProperties } from "react";

export const s = {
  page: { padding: "24px 28px 40px", maxWidth: 720, margin: "0 auto" } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    marginBottom: 22,
  } satisfies CSSProperties,

  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  stepCircle: (active: boolean): CSSProperties => ({
    width: 22,
    height: 22,
    borderRadius: 99,
    background: active ? "var(--accent-bg)" : "var(--bg-hover)",
    color: active ? "var(--accent-text)" : "var(--text-muted)",
    fontSize: 12,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  }),
  stepLabel: (active: boolean): CSSProperties => ({
    fontSize: 13.5,
    fontWeight: 600,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
  selectAllLink: {
    marginLeft: "auto",
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  } satisfies CSSProperties,

  stepBody: { marginLeft: 32, marginBottom: 24 } satisfies CSSProperties,
  agentList: {
    marginLeft: 32,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  gate: {
    marginLeft: 32,
    padding: "34px 20px",
    borderRadius: 10,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-elevated)",
    textAlign: "center",
  } satisfies CSSProperties,
  gateIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    background: "var(--bg-hover)",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 12px",
  } satisfies CSSProperties,
  gateTitle: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  gateBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 5,
    maxWidth: 320,
    marginInline: "auto",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  runBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginTop: 26,
    marginLeft: 32,
  } satisfies CSSProperties,
  aggregate: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- AgentPickCard ----
  card: (on: boolean, accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 9,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    border: "1px solid " + (on ? accent : "var(--border)"),
    background: on ? accent + "12" : "var(--bg-elevated)",
    transition: "border-color .12s, background .12s",
  }),
  cardCheck: (on: boolean, accent: string): CSSProperties => ({
    width: 18,
    height: 18,
    borderRadius: 5,
    flexShrink: 0,
    marginTop: 1,
    display: "grid",
    placeItems: "center",
    border: "1.5px solid " + (on ? accent : "var(--border-strong)"),
    background: on ? accent : "transparent",
  }),
  cardIcon: (accent: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: accent + "1f",
    color: accent,
    flexShrink: 0,
  }),
  cardMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  cardName: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  cardSummary: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 3,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  cardMeta: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
};
