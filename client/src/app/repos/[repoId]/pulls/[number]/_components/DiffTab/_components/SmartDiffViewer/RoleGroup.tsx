/* RoleGroup — one Smart Diff section (core / wiring / boilerplate): a label
   row + its files, each rendered through the existing FileCard/CodeLine diff
   machinery. Only `collapsible` groups (boilerplate) get a section-level
   open/closed toggle of their own, independent of each FileCard's own
   internal open/closed state (Design decision H). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DiffCommentApi } from "@/components/diff-viewer";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { LineFinding } from "@/components/diff-viewer/helpers";
import type { SmartDiffFile, SmartDiffRole } from "@/lib/types";
import { ROLE_ICON, ROLE_LABEL_KEY } from "./constants";
import type { JoinedFile, JumpTarget } from "./helpers";
import { s, groupChevronStyle } from "./styles";

export function RoleGroup({
  role,
  joined,
  collapsible = false,
  open = true,
  onToggleOpen,
  commenting,
  jumpTarget,
  onFindingsClick,
  lineFindings,
  onFocusFinding,
}: {
  role: SmartDiffRole;
  joined: JoinedFile[];
  collapsible?: boolean;
  open?: boolean;
  onToggleOpen?: () => void;
  commenting?: DiffCommentApi;
  jumpTarget: JumpTarget | null;
  onFindingsClick: (file: SmartDiffFile) => void;
  /** path -> (current-file line -> that line's severity/tooltip), for the
     inline per-line badge + left-edge accent + hover tooltip (Design
     decision A still holds: no AI summaries — this is real, already-computed
     finding data, not a new LLM call). */
  lineFindings: Map<string, Map<number, LineFinding>>;
  /** Forwarded straight through to every FileCard — see SmartDiffViewer. */
  onFocusFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const RoleIcon = Icon[ROLE_ICON[role]];

  const header = (
    <>
      <RoleIcon size={14} style={s.groupIcon} />
      <span style={s.groupLabel}>{t(ROLE_LABEL_KEY[role])}</span>
      <span style={s.groupCount}>{t("smartDiff.filesCount", { count: joined.length })}</span>
    </>
  );

  return (
    <div style={s.group}>
      {collapsible ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={onToggleOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleOpen?.();
            }
          }}
          style={s.groupHeaderToggle}
        >
          {header}
          <Icon.ChevronRight size={14} style={groupChevronStyle(open)} />
        </div>
      ) : (
        <div style={s.groupHeader}>{header}</div>
      )}
      {open && (
        <div style={s.groupFiles}>
          {joined.map(({ smart, file }) => (
            <FileCard
              key={smart.path}
              file={file}
              commenting={commenting}
              findingsLabel={
                smart.finding_lines.length > 0
                  ? t("smartDiff.findingLines", { count: smart.finding_lines.length })
                  : undefined
              }
              onFindingsClick={() => onFindingsClick(smart)}
              targetLine={jumpTarget?.path === smart.path ? jumpTarget.line : null}
              targetNonce={jumpTarget?.path === smart.path ? jumpTarget.nonce : 0}
              lineFindings={lineFindings.get(smart.path)}
              onFocusFinding={onFocusFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
