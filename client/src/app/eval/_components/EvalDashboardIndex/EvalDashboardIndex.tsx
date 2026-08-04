/* EvalDashboardIndex — workspace-wide Eval Dashboard (AC-31/AC-32): one row
   per agent (sparkline + current recall/precision/citation + "last run"
   line, or a neutral empty state for a zero-batch agent), a workspace-wide
   "Recent eval runs · all agents" table, and a "Run all agents" action.
   Per-agent drill-in (/eval/[agentId]) is a later task — each row links
   there even though the route doesn't exist yet. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  SectionLabel,
  Button,
  Sparkline,
  MetricBarCell,
  Skeleton,
  ErrorState,
  EmptyState,
  Icon,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useEvalWorkspaceDashboard, useRunAllAgentEvals } from "@/lib/hooks/eval";
import type { EvalAgentSummary, EvalGlobalRunRow } from "@devdigest/shared";
import {
  formatDate,
  formatPercent,
  formatVersion,
  hasRunBatches,
  passFraction,
  rowPassPercent,
  trendSeries,
} from "./helpers";
import { s } from "./styles";

export function EvalDashboardIndex() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalWorkspaceDashboard();
  const runAll = useRunAllAgentEvals();

  return (
    <AppShell
      crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}
    >
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("workspaceDashboard.title")}</h1>
            <p style={s.subtitle}>{t("workspaceDashboard.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            onClick={() => runAll.mutate()}
            loading={runAll.isPending}
          >
            {runAll.isPending ? t("workspaceDashboard.running") : t("workspaceDashboard.runAll")}
          </Button>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        )}
        {isError && <ErrorState body={t("workspaceDashboard.subtitle")} onRetry={() => refetch()} />}

        {!isLoading && !isError && data && (
          <>
            <section style={s.section}>
              <SectionLabel icon="Cpu">{t("workspaceDashboard.agentsSection")}</SectionLabel>
              {data.agents.length === 0 ? (
                <EmptyState icon="FlaskConical" title={t("workspaceDashboard.noAgents")} />
              ) : (
                <div style={s.agentList}>
                  {data.agents.map((agent) => (
                    <AgentRow key={agent.agent_id} agent={agent} t={t} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionLabel icon="History">{t("workspaceDashboard.recentRunsSection")}</SectionLabel>
              {data.recent_runs.length === 0 ? (
                <Card>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                    {t("workspaceDashboard.noRecentRuns")}
                  </p>
                </Card>
              ) : (
                <Card pad={false}>
                  <div style={s.table}>
                    <div style={s.tableHeadRow}>
                      <span>{t("workspaceDashboard.table.agent")}</span>
                      <span>{t("workspaceDashboard.table.version")}</span>
                      <span>{t("workspaceDashboard.table.recall")}</span>
                      <span>{t("workspaceDashboard.table.precision")}</span>
                      <span>{t("workspaceDashboard.table.citation")}</span>
                      <span>{t("workspaceDashboard.table.pass")}</span>
                      <span>{t("workspaceDashboard.table.cost")}</span>
                      <span>{t("workspaceDashboard.table.date")}</span>
                    </div>
                    {data.recent_runs.map((row) => (
                      <RunRow key={row.run_id} row={row} />
                    ))}
                  </div>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function AgentRow({
  agent,
  t,
}: {
  agent: EvalAgentSummary;
  t: ReturnType<typeof useTranslations>;
}) {
  const populated = hasRunBatches(agent);
  const latest = agent.dashboard.recent_runs[0];
  const { passed, total } = passFraction(agent);

  return (
    <Link href={`/eval/${agent.agent_id}`} style={s.agentRowLink}>
      <Card hover>
        <div style={s.agentRow}>
          <div style={s.agentIconBox}>
            <Icon.Cpu size={15} />
          </div>
          <div style={s.agentMain}>
            <div style={s.agentNameRow}>
              <span style={s.agentName}>{agent.agent_name}</span>
              <Badge color="var(--text-secondary)" mono>
                {agent.agent_model}
              </Badge>
            </div>
            <div style={s.agentMeta}>
              {populated && latest
                ? t("workspaceDashboard.lastRun", {
                    version: latest.agent_version,
                    date: formatDate(latest.ran_at),
                    passed,
                    total,
                  })
                : t("workspaceDashboard.noRunsYet")}
            </div>
          </div>
          {populated ? (
            <>
              <div style={s.agentSparkline}>
                <Sparkline data={trendSeries(agent)} />
              </div>
              <div style={s.metricCols}>
                <Metric
                  label={t("workspaceDashboard.recall")}
                  value={agent.dashboard.current.recall}
                  color="var(--accent)"
                />
                <Metric
                  label={t("workspaceDashboard.precision")}
                  value={agent.dashboard.current.precision}
                  color="var(--ok)"
                />
                <Metric
                  label={t("workspaceDashboard.citation")}
                  value={agent.dashboard.current.citation_accuracy}
                  color="var(--warn)"
                />
              </div>
            </>
          ) : null}
          <Icon.ChevronRight size={16} style={s.agentChevron} />
        </div>
      </Card>
    </Link>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={s.metricCol}>
      <div style={s.metricLabel}>{label}</div>
      <div style={s.metricValue(color)}>{formatPercent(value)}</div>
    </div>
  );
}

function RunRow({ row }: { row: EvalGlobalRunRow }) {
  return (
    <div style={s.tableRow}>
      <span>{row.agent_name}</span>
      <span className="mono">{formatVersion(row.agent_version)}</span>
      <MetricBarCell value={row.recall} color="var(--accent)" formatted={formatPercent(row.recall)} />
      <MetricBarCell value={row.precision} color="var(--ok)" formatted={formatPercent(row.precision)} />
      <MetricBarCell
        value={row.citation_accuracy}
        color="var(--warn)"
        formatted={formatPercent(row.citation_accuracy)}
      />
      <span>{rowPassPercent(row)}</span>
      <span>{row.cost_usd != null ? `$${row.cost_usd.toFixed(3)}` : "—"}</span>
      <span>{formatDate(row.ran_at)}</span>
    </div>
  );
}
