/* SymbolRow — one changed symbol in the Blast Radius tree: a collapsible
   header (chevron + name + kind + caller count) and, when open, its callers
   (each clickable — jumps to that line in Files changed if the caller's file
   is part of this PR's diff, else opens it on GitHub in a new tab, since a
   caller is usually a file this PR never touched) plus any endpoint/cron
   badges. Mirrors FileCard's open/chevron/scroll pattern. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { DownstreamImpact } from "@/lib/types";
import { s, chevronStyle } from "./styles";

export function SymbolRow({
  impact,
  defaultOpen,
  diffPaths,
  onJumpToCode,
}: {
  impact: DownstreamImpact;
  defaultOpen?: boolean;
  /** Paths this PR's diff actually contains — decides the per-caller icon
     (in-diff jump vs. external GitHub link) so a click never surprises. */
  diffPaths: ReadonlySet<string>;
  onJumpToCode: (path: string, line: number) => void;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(!!defaultOpen);

  return (
    <div style={s.symbolRow}>
      <div style={s.symbolHeader} onClick={() => setOpen((o) => !o)}>
        <Icon.ChevronRight size={13} style={chevronStyle(open)} />
        <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.symbolName}>
          {impact.symbol}
        </span>
        <span style={s.symbolCallerCount}>{t("callerCount", { count: impact.callers.length })}</span>
      </div>
      {open && (
        <div style={s.symbolBody}>
          {impact.callers.length === 0 ? (
            <div style={s.emptyCallers}>{t("noDownstream", { count: 1 })}</div>
          ) : (
            <div style={s.callerList}>
              {impact.callers.map((c, i) => {
                const inDiff = diffPaths.has(c.file);
                const JumpIcon = inDiff ? Icon.CornerDownRight : Icon.ExternalLink;
                return (
                  <button
                    key={`${c.file}:${c.line}:${i}`}
                    type="button"
                    style={s.callerRow}
                    title={inDiff ? undefined : "Not part of this PR's diff — opens on GitHub"}
                    onClick={() => onJumpToCode(c.file, c.line)}
                  >
                    <JumpIcon size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span className="mono" style={s.callerName}>
                      {c.name}
                    </span>
                    <span className="mono" style={s.callerLoc}>
                      {c.file}:{c.line}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {(impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0) && (
            <div style={s.badgeRow}>
              {impact.endpoints_affected.map((e) => (
                <Badge key={e} icon="Globe" mono>
                  {e}
                </Badge>
              ))}
              {impact.crons_affected.map((c) => (
                <Badge key={c} icon="Clock" mono>
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
