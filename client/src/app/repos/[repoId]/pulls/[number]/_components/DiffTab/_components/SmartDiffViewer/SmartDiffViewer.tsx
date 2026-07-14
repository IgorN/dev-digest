/* SmartDiffViewer — the Files-changed tab's DEFAULT view (Design decision H):
   groups files by risk role (core/wiring/boilerplate, server-returned order —
   never re-sorted here), renders each through the existing FileCard/CodeLine
   diff machinery, keeps the boilerplate section collapsed by default behind
   its own section-level toggle, and wires each file's "N finding-lines"
   badge to a click-to-line jump (expand section if needed → expand that
   file's own FileCard → scroll to and highlight one finding line). Each
   click CYCLES to the next distinct finding line (wraps around) so all N are
   reachable, not just the first. Every finding line also gets its own
   always-visible inline severity chip (no click needed) via `reviews`.
   `pseudocode_summary` is never read here — no AI-summary UI (Design
   decision A). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { PrFile, ReviewRecord, SmartDiff, SmartDiffFile, SmartDiffRole } from "@/lib/types";
import { RoleGroup } from "./RoleGroup";
import { SplitSuggestionBanner } from "./SplitSuggestionBanner";
import { buildLineFindings, joinFiles, type JumpTarget } from "./helpers";
import { s } from "./styles";

export function SmartDiffViewer({
  data,
  files,
  reviews,
  commenting,
  onFocusFinding,
}: {
  data: SmartDiff;
  /** The PR's full file list — SmartDiffFile carries no `patch`, so it's
     joined back in by path (a file with no match is skipped, not crashed on). */
  files: PrFile[];
  /** Already-fetched reviews (same data FindingsTab uses) — read here ONLY to
     derive each line's severity (badge colour + left-edge accent) and hover
     tooltip text; the "N finding-lines" count itself still comes from `data`
     (the SmartDiff response), never recomputed from this. */
  reviews: ReviewRecord[];
  commenting?: DiffCommentApi;
  /** Fired with a finding's id when a per-line severity badge is clicked —
     forwarded straight through to every FileCard/CodeLine; the page uses it
     to switch to the Findings tab with that finding's card expanded. Hover
     stays a separate, always-available preview (see FindingsPeekBadge). */
  onFocusFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const [boilerplateOpen, setBoilerplateOpen] = React.useState(false);
  const [jumpTarget, setJumpTarget] = React.useState<JumpTarget | null>(null);
  const jumpNonce = React.useRef(0);
  // Which distinct finding-line this file's badge landed on last, so repeated
  // clicks CYCLE through every finding instead of re-jumping to the first one
  // every time (the header badge is the "N findings" count; this is how you
  // actually reach all N, not just the first).
  const lastJumpIndex = React.useRef(new Map<string, number>());

  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const joinedGroups = React.useMemo(
    () => data.groups.map((g) => ({ role: g.role, joined: joinFiles(g.files, byPath) })),
    [data.groups, byPath]
  );
  const lineFindings = React.useMemo(() => buildLineFindings(reviews), [reviews]);

  function handleFindingsClick(role: SmartDiffRole, file: SmartDiffFile) {
    if (file.finding_lines.length === 0) return;
    if (role === "boilerplate") setBoilerplateOpen(true);
    // Distinct lines only — a line with 2+ stacked findings (finding_lines
    // isn't deduped, by design) shouldn't make a click look like a no-op.
    const distinctLines = [...new Set(file.finding_lines)];
    const prevIndex = lastJumpIndex.current.get(file.path) ?? -1;
    const nextIndex = (prevIndex + 1) % distinctLines.length;
    lastJumpIndex.current.set(file.path, nextIndex);
    jumpNonce.current += 1;
    setJumpTarget({ path: file.path, line: distinctLines[nextIndex]!, nonce: jumpNonce.current });
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
            lineFindings={lineFindings}
            onFocusFinding={onFocusFinding}
          />
        )
      )}
    </div>
  );
}
