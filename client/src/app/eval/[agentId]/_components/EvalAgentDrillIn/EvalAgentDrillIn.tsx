/* EvalAgentDrillIn — per-agent Eval Dashboard drill-in (AC-33–AC-35): metric
   tiles + deltas, a metric-trend line chart, and a "Recent runs" table with
   checkbox row selection feeding a (currently stubbed) "Compare runs" action.

   The Compare-runs MODAL itself is T16 (depends on this task, edits this same
   file sequentially — not concurrently). The seam left for it: `selectedRunIds`
   / `selectedRuns` (the two picked `EvalTrendPoint`s, older→newer once T16
   sorts them) and `compareOpen` local state, plus a marked spot below the
   table where the modal renders once T16 lands. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  SectionLabel,
  Button,
  Checkbox,
  LineChart,
  Sparkline,
  MetricBarCell,
  Skeleton,
  ErrorState,
  EmptyState,
  Icon,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentEvalDashboard, useRunEvalBatch } from "@/lib/hooks/eval";
import { useAgent } from "@/lib/hooks/agents";
import { formatCost } from "@/lib/cost";
import { CompareRunsModal } from "../CompareRunsModal";
import type { EvalTrendPoint } from "@devdigest/shared";
import {
  deltaColor,
  deltaDirection,
  formatDate,
  formatDeltaPoints,
  formatPercent,
  formatVersion,
  passRateColor,
  tileTrend,
  toChartSeries,
  toggleRunSelection,
} from "./helpers";
import { CHART_Y_MAX, CHART_Y_MIN, COMPARE_SELECTION_SIZE } from "./constants";
import { s } from "./styles";

export function EvalAgentDrillIn({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: agent } = useAgent(agentId);
  const { data: dashboard, isLoading, isError, refetch } = useAgentEvalDashboard(agentId);
  const runBatch = useRunEvalBatch(agentId);

  // --- Compare-runs selection state (this task's deliverable) + the seam
  //     T16 (Compare-runs modal) will build its rendering on top of. ---
  const [selectedRunIds, setSelectedRunIds] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const toggleRow = (runId: string) => {
    setSelectedRunIds((prev) => toggleRunSelection(prev, runId));
  };
  const canCompare = selectedRunIds.length === COMPARE_SELECTION_SIZE;
  const selectedRuns = dashboard
    ? dashboard.recent_runs.filter((r) => selectedRunIds.includes(r.run_id))
    : [];

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? agentId },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {agent ? `${agent.name} · ${agent.model}` : t("dashboard.defaultTitle")}
            </h1>
            {dashboard && (
              <p style={s.subtitle}>
                {t("dashboard.casesSummary", {
                  count: dashboard.cases_total,
                  runs: dashboard.trend.length,
                })}
              </p>
            )}
          </div>
          <div style={s.headerActions}>
            <Button
              kind="primary"
              icon="Play"
              onClick={() => runBatch.mutate({})}
              loading={runBatch.isPending}
            >
              {runBatch.isPending
                ? t("dashboard.running")
                : t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 })}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={90} />
            <Skeleton height={220} />
          </div>
        )}
        {isError && <ErrorState body={t("dashboard.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && dashboard && (
          <>
            {dashboard.alert && (
              <Card style={s.alertBanner}>
                <div style={s.alertHeader}>
                  <Icon.AlertTriangle size={16} style={s.alertIcon} />
                  {/* Rendered VERBATIM — this string is already fully composed
                     server-side (selectNotableMetric, AC-34); never
                     recompute/reformat it here. */}
                  <p style={s.alertBody}>{dashboard.alert}</p>
                </div>
              </Card>
            )}

            <div style={s.tiles}>
              <MetricTile
                label={t("dashboard.metrics.recall")}
                value={dashboard.current.recall}
                delta={dashboard.delta.recall}
                trend={tileTrend(dashboard.trend, "recall")}
                color="var(--accent)"
              />
              <MetricTile
                label={t("dashboard.metrics.precision")}
                value={dashboard.current.precision}
                delta={dashboard.delta.precision}
                trend={tileTrend(dashboard.trend, "precision")}
                color="var(--ok)"
              />
              <MetricTile
                label={t("dashboard.metrics.citationAccuracy")}
                value={dashboard.current.citation_accuracy}
                delta={dashboard.delta.citation_accuracy}
                trend={tileTrend(dashboard.trend, "citation_accuracy")}
                color="var(--warn)"
              />
            </div>

            <section style={s.section}>
              <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
              {dashboard.trend.length === 0 ? (
                <EmptyState icon="FlaskConical" title={t("dashboard.noRuns")} />
              ) : (
                <Card>
                  <LineChart
                    series={toChartSeries(dashboard.trend, {
                      recall: t("dashboard.legend.recall"),
                      precision: t("dashboard.legend.precision"),
                      citation: t("dashboard.legend.citation"),
                    })}
                    yMin={CHART_Y_MIN}
                    yMax={CHART_Y_MAX}
                  />
                </Card>
              )}
            </section>

            <section>
              <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
              {dashboard.recent_runs.length === 0 ? (
                <EmptyState icon="History" title={t("dashboard.noRuns")} />
              ) : (
                <>
                  <Card pad={false}>
                    <div style={s.table}>
                      <div style={s.tableHeadRow}>
                        <span />
                        <span>{t("dashboard.table.version")}</span>
                        <span>{t("dashboard.table.ranAt")}</span>
                        <span>{t("dashboard.table.recall")}</span>
                        <span>{t("dashboard.table.precision")}</span>
                        <span>{t("dashboard.table.citation")}</span>
                        <span>{t("dashboard.table.pass")}</span>
                        <span>{t("dashboard.table.cost")}</span>
                      </div>
                      {dashboard.recent_runs.map((row) => (
                        <RunRow
                          key={row.run_id}
                          row={row}
                          checked={selectedRunIds.includes(row.run_id)}
                          onToggle={() => toggleRow(row.run_id)}
                        />
                      ))}
                    </div>
                  </Card>
                  <div style={s.footer}>
                    <Button
                      kind="secondary"
                      icon="Layers"
                      disabled={!canCompare}
                      onClick={() => {
                        if (!canCompare) return;
                        // T16 (Compare-runs modal, sequential edit to this
                        // file) wires the real modal to this flag + the
                        // `selectedRuns` computed above. Until then this is a
                        // harmless no-op toggle.
                        setCompareOpen((open) => !open);
                      }}
                    >
                      {t("dashboard.compareRuns")}
                    </Button>
                  </div>
                </>
              )}
            </section>

            {/* --- T16 seam ---------------------------------------------
               Mounted only while open + exactly 2 selected — mirrors this
               codebase's existing modal convention (no internal `open` prop;
               the caller conditionally renders the whole component, see
               CreateAgentModal / EvalCaseEditor). */}
            {compareOpen && canCompare && selectedRuns.length === COMPARE_SELECTION_SIZE && (
              <CompareRunsModal
                agentId={agentId}
                runs={selectedRuns}
                onClose={() => setCompareOpen(false)}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function MetricTile({
  label,
  value,
  delta,
  trend,
  color,
}: {
  label: string;
  value: number;
  delta: number;
  trend: number[];
  color: string;
}) {
  const dir = deltaDirection(delta);
  const DeltaIcon = dir === "flat" ? Icon.Slash : dir === "up" ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <Card style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)" }}>
          {label}
        </div>
        {trend.length > 0 && <Sparkline data={trend} color={color} w={56} h={20} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
        <span className="tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {formatPercent(value)}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontSize: 12.5,
            fontWeight: 600,
            color: deltaColor(delta),
          }}
        >
          <DeltaIcon size={12} />
          {formatDeltaPoints(delta)}
        </span>
      </div>
    </Card>
  );
}

function RunRow({
  row,
  checked,
  onToggle,
}: {
  row: EvalTrendPoint;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={s.tableRow}>
      <Checkbox checked={checked} onChange={onToggle} />
      <span className="mono">{formatVersion(row.agent_version)}</span>
      <span>{formatDate(row.ran_at)}</span>
      <MetricBarCell value={row.recall} color="var(--accent)" formatted={formatPercent(row.recall)} />
      <MetricBarCell value={row.precision} color="var(--ok)" formatted={formatPercent(row.precision)} />
      <MetricBarCell
        value={row.citation_accuracy}
        color="var(--warn)"
        formatted={formatPercent(row.citation_accuracy)}
      />
      <span style={{ color: passRateColor(row.pass_rate), fontWeight: 600 }}>
        {formatPercent(row.pass_rate)}
      </span>
      <span>{formatCost(row.cost_usd)}</span>
    </div>
  );
}
