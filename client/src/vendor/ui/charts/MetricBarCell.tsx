/* MetricBarCell — a percentage value with a thin colored fill bar underneath,
   for a table cell (e.g. a "recent runs" row's Recall/Precision/Citation
   columns). Lighter than BarRow: no label/suffix columns, just value + bar. */
import React from "react";

export function MetricBarCell({
  value,
  color = "var(--accent)",
  formatted,
}: {
  /** Fraction in [0, 1] — drives the bar's fill width. */
  value: number;
  color?: string;
  /** Pre-formatted display text (e.g. "82%"); falls back to a plain percent. */
  formatted?: string;
}) {
  return (
    <div>
      <span className="tnum">{formatted ?? `${Math.round(value * 100)}%`}</span>
      <div
        style={{
          marginTop: 4,
          height: 4,
          background: "var(--bg-hover)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            height: "100%",
            background: color,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
