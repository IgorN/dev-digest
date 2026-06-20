/* SeverityFilter — findings-by-severity counter bar for the PR page.
   Renders one chip per severity that has findings ("CRITICAL 3 · WARNING 5 · …")
   and acts as a toggle: click a chip to show only that severity, click the active
   chip (or it again) to clear. Renders nothing when there are no findings. */
"use client";

import React from "react";
import { SeverityBadge, type Severity } from "@devdigest/ui";

/** Display/priority order; only severities with a non-zero count are shown. */
const ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];

export function SeverityFilter({
  counts,
  active,
  onSelect,
}: {
  /** Finding count per severity (keys are Severity values). */
  counts: Record<string, number>;
  /** Currently-selected severity, or null when unfiltered. */
  active: Severity | null;
  onSelect: (severity: Severity | null) => void;
}) {
  const present = ORDER.filter((sev) => (counts[sev] ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      role="group"
      aria-label="Filter findings by severity"
    >
      {present.map((sev, i) => {
        const isActive = active === sev;
        const dimmed = active != null && !isActive;
        return (
          <React.Fragment key={sev}>
            {i > 0 && (
              <span aria-hidden style={{ color: "var(--text-muted)" }}>
                ·
              </span>
            )}
            <button
              type="button"
              aria-pressed={isActive}
              title={isActive ? "Show all findings" : `Show only ${sev} findings`}
              onClick={() => onSelect(isActive ? null : sev)}
              style={{
                background: "none",
                border: "1px solid",
                borderColor: isActive ? "var(--border-strong)" : "transparent",
                borderRadius: 7,
                padding: 1,
                cursor: "pointer",
                opacity: dimmed ? 0.4 : 1,
                transition: "opacity .1s",
              }}
            >
              <SeverityBadge severity={sev} count={counts[sev]} />
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
