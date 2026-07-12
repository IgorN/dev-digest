/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES, LINE_HIGHLIGHT_MS } from "../constants";
import { parsePatch, diffLineElementId, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findingsLabel,
  onFindingsClick,
  targetLine = null,
  targetNonce = 0,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Pre-formatted "N finding-lines" text; renders a clickable badge in the
     header when set. The caller owns the copy/i18n (Smart Diff's
     `prReview.smartDiff.findingLines`) so FileCard stays domain-agnostic —
     it's also used by the plain flat DiffViewer, which never passes this. */
  findingsLabel?: string;
  /** Fired when the findings badge is clicked (Smart Diff wires this to its
     own click-to-line handler; FileCard doesn't need to know the actual
     finding line numbers, just that a click happened). */
  onFindingsClick?: () => void;
  /** External "jump to this line" instruction (new/current-file line number).
     Forces the card open and scrolls+highlights that line once it's
     rendered. Bump targetNonce to re-trigger the same line — mirrors
     ReviewRunAccordion's targetRunId/targetNonce pattern. */
  targetLine?: number | null;
  targetNonce?: number;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    targetLine != null || (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const [highlightLine, setHighlightLine] = React.useState<number | null>(null);
  const pendingScrollLine = React.useRef<number | null>(null);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // A click-to-line instruction arrived (or was re-fired via targetNonce):
  // force the card open and remember which line to jump to once it's mounted.
  React.useEffect(() => {
    if (targetLine == null) return;
    pendingScrollLine.current = targetLine;
    setOpen(true);
  }, [targetLine, targetNonce]);

  // Once the body reflects `open`, the target row (if any) actually exists in
  // the DOM — scroll it into view and flash-highlight it briefly. Re-runs
  // (harmlessly) whenever a new instruction arrives, whether or not `open`
  // itself changed, so re-clicking an already-open file's badge still jumps.
  React.useEffect(() => {
    if (!open || pendingScrollLine.current == null) return;
    const line = pendingScrollLine.current;
    pendingScrollLine.current = null;
    const el = document.getElementById(diffLineElementId(file.path, line));
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlightLine(line);
    const timer = setTimeout(() => setHighlightLine(null), LINE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [open, targetLine, targetNonce, file.path]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {findingsLabel && (
          <button
            type="button"
            onClick={(e) => {
              // Don't let this bubble to the header's own open/close toggle —
              // an already-open card must stay open when its badge is clicked.
              e.stopPropagation();
              onFindingsClick?.();
            }}
            aria-label={findingsLabel}
            title={findingsLabel}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--warn)",
              background: "var(--bg-hover)",
              border: "none",
              borderRadius: 5,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            <Icon.AlertOctagon size={12} />
            {findingsLabel}
          </button>
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                highlighted={highlightLine != null && ln.newNo === highlightLine}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
