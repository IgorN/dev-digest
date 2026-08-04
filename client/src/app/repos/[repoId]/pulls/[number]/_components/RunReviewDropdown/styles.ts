import type { CSSProperties } from "react";
import { PANEL_WIDTH } from "./constants";

/** Co-located styles for RunReviewDropdown's agent picker.
   Values are taken verbatim from the design source
   (`design-src/components2.jsx`, `RunReviewDropdown` :24-65). */
export const s = {
  root: { position: "relative", display: "inline-block" },

  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 30,
    width: PANEL_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "0 14px 40px rgba(0,0,0,.4)",
    overflow: "hidden",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "11px 14px 8px",
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  },
  headerLink: {
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  },

  warning: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 14px 8px",
    fontSize: 11.5,
    color: "var(--warn)",
  },

  rowName: { fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, textAlign: "left" },
  rowHint: { fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 },

  empty: {
    padding: "6px 14px 12px",
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },

  launchWrap: {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    marginTop: 4,
  },
  launchButton: { width: "100%", justifyContent: "center" },

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "9px 14px",
    border: "none",
    borderTop: "1px solid var(--border)",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-muted)",
    fontSize: 12,
    fontFamily: "inherit",
  },
} satisfies Record<string, CSSProperties>;

/** Row button — hover paints `--bg-hover`, exactly as the design source does. */
export function rowStyle(hovered: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 14px",
    border: "none",
    background: hovered ? "var(--bg-hover)" : "transparent",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
    fontFamily: "inherit",
  };
}

/** The 16×16 checkbox square; filled with the accent colour when checked. */
export function boxStyle(checked: boolean): CSSProperties {
  return {
    width: 16,
    height: 16,
    borderRadius: 4,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: checked ? "var(--accent)" : "var(--border-strong)",
    background: checked ? "var(--accent)" : "transparent",
  };
}
