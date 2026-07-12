/* FindingsPeekBadge — a diff row's per-line severity badge, with a hover
   popover listing every finding at that line (title, category, file:line,
   confidence, rationale). Visually mirrors `@/components/FindingsSummary`'s
   own hover-peek (same card layout, same `position: fixed` + short
   close-delay mechanics, escaping any ancestor `overflow: hidden`) rather
   than the previous plain `title`-attribute tooltip, which had an
   unpredictable, OS-controlled hover delay and no formatting. Clicking the
   badge itself re-flashes its own row (see FileCard's flashLine). */
"use client";

import React from "react";
import { Icon, SEV, CAT } from "@devdigest/ui";
import type { LineFinding } from "../helpers";
import { severityBadgeStyle } from "../styles";

const PEEK_WIDTH = 380;
const PEEK_MAX_HEIGHT = 360;
const CLOSE_DELAY_MS = 160;

const peekStyle: React.CSSProperties = {
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

export function FindingsPeekBadge({ finding, onClick }: { finding: LineFinding; onClick?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);

  function handleEnter(e: React.MouseEvent<HTMLElement>) {
    cancelClose();
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.right - PEEK_WIDTH, window.innerWidth - PEEK_WIDTH - 12));
    const below = rect.bottom + 6;
    const top =
      below + PEEK_MAX_HEIGHT > window.innerHeight - 12
        ? Math.max(12, rect.top - 6 - PEEK_MAX_HEIGHT)
        : below;
    setPos({ top, left });
    setOpen(true);
  }

  const worst = finding.findings[0]!;
  const meta = SEV[worst.severity];
  const SeverityIcon = Icon[meta.icon];

  return (
    <>
      <button
        type="button"
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
        onClick={onClick}
        aria-label={`${finding.findings.length} finding${finding.findings.length === 1 ? "" : "s"}, worst severity ${meta.label}`}
        style={severityBadgeStyle(meta.c, meta.bg)}
      >
        <SeverityIcon size={11} />
        {meta.label}
      </button>

      {open && (
        <div
          style={{ ...peekStyle, top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          {finding.findings.map((f, i) => {
            const fMeta = SEV[f.severity];
            const FIcon = Icon[fMeta.icon];
            const cat = CAT[f.category];
            return (
              <div key={f.id} style={{ padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FIcon size={14} style={{ color: fMeta.c, flexShrink: 0 }} />
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
                    WebkitLineClamp: 3,
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
    </>
  );
}
