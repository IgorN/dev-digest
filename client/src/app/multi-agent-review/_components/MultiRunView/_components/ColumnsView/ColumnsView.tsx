/* ColumnsView — one equal-width column per participating agent (AC-34 – AC-36).
   Ported from the design gallery's `ColumnsView` (screen_multiagent.jsx:52),
   `AgentColHeader` (:12) and `AgentFindingMini` (:3). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink, SEV, type Severity } from "@devdigest/ui";
import type { FindingRecord, MultiRunAgent } from "@devdigest/shared";
import { AGENT_ICON, MAX_COLUMNS } from "../../../constants";
import { accentForIndex, formatDurationMs, formatUsd } from "../../../helpers";
import { statusColor, statusKey } from "../../helpers";
import { s } from "./styles";

function sevOf(severity: string) {
  return SEV[severity as Severity] ?? SEV.INFO;
}

function FindingMini({ finding }: { finding: FindingRecord }) {
  const sev = sevOf(finding.severity);
  const SevGlyph = Icon[sev.icon];
  return (
    <div style={s.finding(sev.c)}>
      <div style={s.findingTitleRow}>
        <SevGlyph size={12} style={{ color: sev.c, flexShrink: 0 }} />
        <span style={s.findingTitle}>{finding.title}</span>
      </div>
      <div className="mono" style={s.findingFile}>
        {finding.file}:{finding.start_line}
      </div>
    </div>
  );
}

function AgentColumn({
  agent,
  accent,
  onViewTrace,
}: {
  agent: MultiRunAgent;
  accent: string;
  onViewTrace: () => void;
}) {
  const t = useTranslations("multiAgent");
  const AgentGlyph = Icon[AGENT_ICON];
  const sk = statusKey(agent.status);
  return (
    <div style={s.column}>
      <div style={s.columnHeader(accent)}>
        <div style={s.headerRow}>
          <div style={s.headerIcon(accent)}>
            <AgentGlyph size={16} />
          </div>
          <div style={s.headerMain}>
            <div style={s.headerNameRow}>
              <span style={s.headerName}>{agent.agent_name}</span>
              {/* AC-37: live status is text, never colour alone. */}
              {sk && (
                <span style={s.headerStatus(statusColor(agent.status))}>{t(`result.status.${sk}`)}</span>
              )}
            </div>
            <div className="mono tnum" style={s.headerMeta}>
              {formatDurationMs(agent.duration_ms)} · {formatUsd(agent.cost_usd)}
            </div>
          </div>
          {agent.score != null ? (
            <CircularScore score={agent.score} size={32} stroke={3.5} />
          ) : (
            <span style={s.scorePlaceholder}>—</span>
          )}
        </div>
      </div>

      <div style={s.body}>
        {agent.findings.length === 0 ? (
          <span style={s.bodyEmpty}>{t("result.noFindings")}</span>
        ) : (
          agent.findings.map((f) => <FindingMini key={f.id} finding={f} />)
        )}
      </div>

      <div style={s.footer}>
        <MonoLink onClick={onViewTrace}>{t("result.viewTrace")}</MonoLink>
        <span style={s.footerCount}>{t("result.findingsCount", { count: agent.findings.length })}</span>
      </div>
    </div>
  );
}

export function ColumnsView({
  agents,
  onViewTrace,
}: {
  agents: MultiRunAgent[];
  onViewTrace: (runId: string) => void;
}) {
  const cols = Math.min(Math.max(agents.length, 1), MAX_COLUMNS);
  return (
    <div style={s.wrap}>
      <div style={s.grid(cols, agents.length > MAX_COLUMNS)}>
        {agents.map((agent, i) => (
          <AgentColumn
            key={agent.run_id}
            agent={agent}
            accent={accentForIndex(i)}
            onViewTrace={() => onViewTrace(agent.run_id)}
          />
        ))}
      </div>
    </div>
  );
}
