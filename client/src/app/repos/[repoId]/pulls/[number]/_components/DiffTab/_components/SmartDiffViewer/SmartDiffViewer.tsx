/* SmartDiffViewer — the Files-changed tab's DEFAULT view (Design decision H):
   groups files by risk role (core/wiring/boilerplate, server-returned order —
   never re-sorted here), renders each through the existing FileCard/CodeLine
   diff machinery, keeps the boilerplate section collapsed by default behind
   its own section-level toggle, and wires each file's "N finding-lines"
   badge to a click-to-line jump (expand section if needed → expand that
   file's own FileCard → scroll to and highlight finding_lines[0]).
   `pseudocode_summary` is never read here — no AI-summary UI (Design
   decision A). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { PrFile, SmartDiff, SmartDiffFile, SmartDiffRole } from "@/lib/types";
import { RoleGroup } from "./RoleGroup";
import { SplitSuggestionBanner } from "./SplitSuggestionBanner";
import { joinFiles, type JumpTarget } from "./helpers";
import { s } from "./styles";

export function SmartDiffViewer({
  data,
  files,
  commenting,
}: {
  data: SmartDiff;
  /** The PR's full file list — SmartDiffFile carries no `patch`, so it's
     joined back in by path (a file with no match is skipped, not crashed on). */
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("shell");
  const [boilerplateOpen, setBoilerplateOpen] = React.useState(false);
  const [jumpTarget, setJumpTarget] = React.useState<JumpTarget | null>(null);
  const jumpNonce = React.useRef(0);

  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const joinedGroups = React.useMemo(
    () => data.groups.map((g) => ({ role: g.role, joined: joinFiles(g.files, byPath) })),
    [data.groups, byPath]
  );

  function handleFindingsClick(role: SmartDiffRole, file: SmartDiffFile) {
    if (file.finding_lines.length === 0) return;
    if (role === "boilerplate") setBoilerplateOpen(true);
    jumpNonce.current += 1;
    setJumpTarget({ path: file.path, line: file.finding_lines[0]!, nonce: jumpNonce.current });
  }

  if (joinedGroups.every((g) => g.joined.length === 0)) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }

  return (
    <div style={s.root}>
      {data.split_suggestion.too_big && (
        <SplitSuggestionBanner splitSuggestion={data.split_suggestion} />
      )}
      {joinedGroups.map(({ role, joined }) =>
        joined.length === 0 ? null : (
          <RoleGroup
            key={role}
            role={role}
            joined={joined}
            collapsible={role === "boilerplate"}
            open={role === "boilerplate" ? boilerplateOpen : true}
            onToggleOpen={role === "boilerplate" ? () => setBoilerplateOpen((o) => !o) : undefined}
            commenting={commenting}
            jumpTarget={jumpTarget}
            onFindingsClick={(file) => handleFindingsClick(role, file)}
          />
        )
      )}
    </div>
  );
}
