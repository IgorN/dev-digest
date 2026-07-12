/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@/lib/types";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { diffLineElementId, type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, severityBadgeStyle } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  highlighted = false,
  severity,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Smart Diff's click-to-line target briefly flashes this row (Design
     decision H's per-line DOM anchor). Ignored by the flat DiffViewer, which
     never passes it. */
  highlighted?: boolean;
  /** Smart Diff's per-line severity tag (worst finding at this line), e.g.
     the mockup's inline "suggestion" / "warning" / "blocker" chips. Ignored
     by the flat DiffViewer, which never passes it. */
  severity?: Severity;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  // Only add/ctx lines have a "new" (current-file) line number — that's what
  // finding_lines refers to, so a pure deletion never gets an anchor id.
  const anchorId = ln.newNo != null ? diffLineElementId(path, ln.newNo) : undefined;
  const SeverityIcon = severity ? Icon[SEV[severity].icon] : null;

  return (
    <div
      id={anchorId}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...lineRowFor(ln.kind), ...(highlighted ? s.lineHighlight : undefined) }}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {severity && SeverityIcon && (
          <span style={severityBadgeStyle(SEV[severity].c, SEV[severity].bg)}>
            <SeverityIcon size={11} />
            {SEV[severity].label}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
