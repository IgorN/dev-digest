/* ConflictsSection — "Where agents disagree" (AC-53 – AC-59).

   Renders the SERVER-computed groups; it never recomputes them. Cells arrive in
   the multi-run's agent order, which is the same order the columns and tabs
   use, so the Nth cell always lines up with the Nth column (AC-59).

   Ported from the design gallery's `ConflictsSection`
   (design-src/screen_multiagent.jsx:21) with ONE deliberate departure: the
   design renders a rationale line on every cell, including non-flagging ones
   ("No perf impact."). That text exists nowhere in the data — an agent that did
   not flag a location produced no artifact about it — so `did not flag` and
   `no result` cells carry the dot and the text only (the spec's accepted
   deviation). Flagging cells DO show a one-line rationale from their real
   finding. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon, SectionLabel, SEV, Toggle, type Severity } from "@devdigest/ui";
import type { MultiRunAgent, MultiRunGroup, MultiRunVerdictCell } from "@devdigest/shared";
import { agentNamesById } from "../../helpers";
import { s } from "./styles";

const NEUTRAL_DOT = "var(--text-muted)";

function verdictColor(cell: MultiRunVerdictCell): string {
  if (cell.verdict !== "flagged") return NEUTRAL_DOT;
  const sev = cell.severity ? SEV[cell.severity as Severity] : undefined;
  return sev?.c ?? "var(--warn)";
}

function VerdictCell({ cell, agentName }: { cell: MultiRunVerdictCell; agentName: string }) {
  const t = useTranslations("multiAgent");
  const flagged = cell.verdict === "flagged";
  const text = flagged
    ? (cell.severity ?? "").toUpperCase()
    : cell.verdict === "did_not_flag"
      ? t("disagree.didNotFlag")
      : t("disagree.noResult");
  return (
    <div style={s.cell}>
      <div style={s.cellAgent}>{agentName}</div>
      {/* Every verdict conveyed by the dot is also conveyed by this text —
          no status by colour alone (R12). */}
      <div style={s.verdictRow}>
        <span style={s.dot(verdictColor(cell))} />
        <span style={s.verdictText(flagged)}>{text}</span>
      </div>
      {flagged && cell.rationale && <div style={s.rationale}>{cell.rationale}</div>}
    </div>
  );
}

function GroupCard({ group, names }: { group: MultiRunGroup; names: Map<string, string> }) {
  return (
    <div style={s.group}>
      <div style={s.groupHeader}>
        <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.groupLocation}>
          {group.file}:{group.line}
        </span>
        <span style={s.groupLabel}>{group.label}</span>
      </div>
      <div style={s.groupBody(Math.max(group.cells.length, 1))}>
        {group.cells.map((cell) => (
          <VerdictCell key={cell.agent_id} cell={cell} agentName={names.get(cell.agent_id) ?? cell.agent_id} />
        ))}
      </div>
    </div>
  );
}

export function ConflictsSection({
  groups,
  agents,
}: {
  groups: MultiRunGroup[];
  agents: MultiRunAgent[];
}) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const names = agentNamesById(agents);
  const shown = onlyConflicts ? groups.filter((g) => g.conflict) : groups;

  return (
    <div style={s.wrap}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.toggleLabel}>
            {t("disagree.showOnlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={15} />
          </label>
        }
      >
        {t("disagree.heading")}
      </SectionLabel>

      {groups.length === 0 ? (
        // AC-58 — an explicit state, never an empty bordered container.
        <EmptyState icon="Activity" title={t("disagree.emptyTitle")} body={t("disagree.emptyBody")} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="Check"
          title={t("disagree.emptyConflictsTitle")}
          body={t("disagree.emptyConflictsBody")}
        />
      ) : (
        <div style={s.list}>
          {shown.map((g) => (
            <GroupCard key={`${g.file}:${g.line}`} group={g} names={names} />
          ))}
        </div>
      )}
    </div>
  );
}
