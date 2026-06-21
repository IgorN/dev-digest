"use client";

/* FindingsSummary — severity icon-counts ("🛑2 ⚠️2 💡2"). Hovering a SINGLE
   severity chip opens a popover listing only THAT severity's findings. Shared by
   the PR list (FINDINGS column) and the PR detail timeline (per-run). Renders "—"
   when there are no findings.

   The popover is `position: fixed` (anchored to the hovered chip via
   getBoundingClientRect) so it escapes the PR-list table's `overflow: hidden`,
   and closing is delayed so the pointer can travel onto the popover and scroll. */

import React from "react";
import { Icon, SEV, CAT, type Severity } from "@devdigest/ui";
import type { Finding } from "@devdigest/shared";

const ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];
const PEEK_WIDTH = 380;
const PEEK_MAX_HEIGHT = 360;

function deriveCounts(findings: Finding[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return c;
}

const peekBase: React.CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  width: PEEK_WIDTH,
  maxHeight: PEEK_MAX_HEIGHT,
  overflowY: "auto",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  cursor: "default",
  textAlign: "left",
};

export function FindingsSummary({
  findings,
  counts,
  label = "findings",
}: {
  /** Findings shown in the popover (may be a capped preview). */
  findings: Finding[];
  /** Exact severity counts for the chips; derived from `findings` when omitted. */
  counts?: Record<string, number>;
  /** Popover header noun, e.g. "findings" or "findings in this run". */
  label?: string;
}) {
  const [hoverSev, setHoverSev] = React.useState<Severity | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHoverSev(null), 160);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);

  const openFor = React.useCallback(
    (sev: Severity, el: HTMLElement) => {
      cancelClose();
      const rect = el.getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - PEEK_WIDTH - 12));
      const below = rect.bottom + 6;
      const top =
        below + PEEK_MAX_HEIGHT > window.innerHeight - 12
          ? Math.max(12, rect.top - 6 - PEEK_MAX_HEIGHT)
          : below;
      setPos({ top, left });
      setHoverSev(sev);
    },
    [cancelClose],
  );

  const c = counts ?? deriveCounts(findings);
  const total = ORDER.reduce((sum, s) => sum + (c[s] ?? 0), 0);
  if (total === 0) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const present = ORDER.filter((s) => (c[s] ?? 0) > 0);
  const shown = hoverSev ? findings.filter((f) => f.severity === hoverSev) : [];

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {present.map((sev) => {
        const meta = SEV[sev];
        const SIcon = Icon[meta.icon];
        return (
          <span
            key={sev}
            className="tnum"
            onMouseEnter={(e) => openFor(sev, e.currentTarget)}
            onMouseLeave={scheduleClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: meta.c,
              fontSize: 12.5,
              cursor: "default",
            }}
          >
            <SIcon size={13} />
            {c[sev]}
          </span>
        );
      })}

      {hoverSev && shown.length > 0 && (
        <div
          style={{ ...peekBase, top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            <Icon.AlertOctagon size={13} />
            {c[hoverSev] ?? shown.length} {hoverSev.toLowerCase()} {label}
          </div>
          {shown.map((f, i) => {
            const meta = SEV[f.severity as Severity];
            const SIcon = Icon[meta.icon];
            const cat = CAT[f.category as keyof typeof CAT];
            return (
              <div
                key={f.id}
                style={{ padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SIcon size={14} style={{ color: meta.c, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{f.title}</span>
                  {cat && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-muted)", fontSize: 11.5 }}>
                      <Icon.Shield size={11} />
                      {cat.label}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 12, marginTop: 3 }}>
                  <span className="mono" style={{ color: "var(--accent-text)" }}>
                    {f.file}:{f.start_line}
                    {f.end_line !== f.start_line ? `-${f.end_line}` : ""}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{Math.round(f.confidence * 100)}% conf</span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {f.rationale}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
