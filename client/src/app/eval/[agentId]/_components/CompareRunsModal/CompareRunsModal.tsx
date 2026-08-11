/* CompareRunsModal — the two-run Compare view for the per-agent Eval
   Dashboard drill-in (AC-36–AC-38): recall/precision/citation-accuracy/cost
   deltas with an icon+text directional indicator (never colour alone), a
   system-prompt diff between the two batches' snapshotted agent versions (or
   an explicit "no change" state when both share one version), and a
   "Promote v‹N›" action per compared version.

   Mounted by the parent (EvalAgentDrillIn) only while both `compareOpen` and
   exactly 2 rows are selected — mirrors this codebase's existing modal
   convention (CreateAgentModal / EvalCaseEditor: no internal `open` prop, the
   caller conditionally renders the whole component). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Skeleton, Icon } from "@devdigest/ui";
import type { AgentVersionConfig, EvalTrendPoint } from "@devdigest/shared";
import { useAgentVersion } from "@/lib/hooks/eval";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { formatCost } from "@/lib/cost";
import {
  costDeltaColor,
  deltaDirection,
  diffLines,
  formatCostDelta,
  formatDeltaPoints,
  formatPercent,
  formatVersion,
  metricDeltaColor,
  sortByRanAt,
  toUpdatePatch,
} from "./helpers";
import { MODAL_WIDTH } from "./constants";
import { diffLineStyleFor, diffSignFor, s } from "./styles";

export interface CompareRunsModalProps {
  agentId: string;
  /** Exactly 2 selected batches, any order — this component sorts them. */
  runs: EvalTrendPoint[];
  onClose: () => void;
}

export function CompareRunsModal({ agentId, runs, onClose }: CompareRunsModalProps) {
  const t = useTranslations("eval.compareModal");
  const [older, newer] = sortByRanAt(runs);
  const olderVersionQuery = useAgentVersion(agentId, older?.agent_version);
  const newerVersionQuery = useAgentVersion(agentId, newer?.agent_version);
  const updateAgent = useUpdateAgent();

  // Defensive — the parent only mounts this with exactly 2 selected runs, but
  // guard against a stale/empty prop rather than crash on `older.recall`.
  if (!older || !newer) return null;

  const sameVersion = older.agent_version === newer.agent_version;

  const handlePromote = (config: AgentVersionConfig | undefined) => {
    if (!config) return;
    updateAgent.mutate(
      { id: agentId, patch: toUpdatePatch(config) },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("title")}
      subtitle={t("subtitle", { older: formatVersion(older.agent_version), newer: formatVersion(newer.agent_version) })}
      onClose={onClose}
    >
      <div style={s.body}>
        <div style={s.deltaGrid}>
          <DeltaTile
            label={t("metrics.recall")}
            value={formatPercent(newer.recall)}
            delta={newer.recall - older.recall}
            kind="metric"
          />
          <DeltaTile
            label={t("metrics.precision")}
            value={formatPercent(newer.precision)}
            delta={newer.precision - older.precision}
            kind="metric"
          />
          <DeltaTile
            label={t("metrics.citation")}
            value={formatPercent(newer.citation_accuracy)}
            delta={newer.citation_accuracy - older.citation_accuracy}
            kind="metric"
          />
          <DeltaTile
            label={t("metrics.cost")}
            value={formatCost(newer.cost_usd)}
            delta={(newer.cost_usd ?? 0) - (older.cost_usd ?? 0)}
            kind="cost"
          />
        </div>

        <div style={s.section}>
          <h3 style={s.sectionTitle}>{t("promptDiffTitle")}</h3>
          {sameVersion ? (
            <div style={s.noChange}>
              <Icon.Check size={15} style={{ color: "var(--ok)", flexShrink: 0 }} />
              {t("noChange")}
            </div>
          ) : olderVersionQuery.isLoading || newerVersionQuery.isLoading ? (
            <Skeleton height={140} />
          ) : olderVersionQuery.data && newerVersionQuery.data ? (
            <PromptDiff
              oldText={olderVersionQuery.data.config.system_prompt}
              newText={newerVersionQuery.data.config.system_prompt}
            />
          ) : (
            <div style={s.noChange}>{t("diffUnavailable")}</div>
          )}
        </div>

        <div style={s.footer}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            disabled={!olderVersionQuery.data || updateAgent.isPending}
            loading={updateAgent.isPending}
            onClick={() => handlePromote(olderVersionQuery.data?.config)}
          >
            {t("promote", { version: formatVersion(older.agent_version) })}
          </Button>
          <Button
            kind="secondary"
            icon="RefreshCw"
            disabled={!newerVersionQuery.data || updateAgent.isPending}
            loading={updateAgent.isPending}
            onClick={() => handlePromote(newerVersionQuery.data?.config)}
          >
            {t("promote", { version: formatVersion(newer.agent_version) })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeltaTile({
  label,
  value,
  delta,
  kind,
}: {
  label: string;
  /** The newer batch's current formatted value (e.g. "92%" or "$0.014"). */
  value: string;
  delta: number;
  kind: "metric" | "cost";
}) {
  const dir = deltaDirection(delta);
  const DeltaIcon = dir === "flat" ? Icon.Slash : dir === "up" ? Icon.ArrowUp : Icon.ArrowDown;
  const color = kind === "metric" ? metricDeltaColor(delta) : costDeltaColor(delta);
  const deltaText = kind === "metric" ? formatDeltaPoints(delta) : formatCostDelta(delta);
  return (
    <div style={s.deltaTile}>
      <span style={s.deltaLabel}>{label}</span>
      <div style={s.deltaRow}>
        <span className="tnum" style={s.deltaValue}>{value}</span>
        <span style={{ ...s.deltaIndicator, color }}>
          <DeltaIcon size={12} />
          {deltaText}
        </span>
      </div>
    </div>
  );
}

function PromptDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = React.useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  return (
    <div style={s.diffPanel} className="mono">
      {lines.map((line, idx) => (
        <div key={idx} style={{ ...s.diffLine, ...diffLineStyleFor(line.kind) }}>
          <span style={s.diffSign}>{diffSignFor(line.kind)}</span>
          <span>{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}
