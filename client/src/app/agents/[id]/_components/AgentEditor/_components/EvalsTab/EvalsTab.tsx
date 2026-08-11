/* EvalsTab — the Agent Editor's Evals tab (L06 — Eval Pipeline, AC-26–AC-29):
   metric tiles + deltas, this agent's eval case list (pass/fail + "expected
   N, got M" + severity badge + run/edit/delete), "Run all evals", "+ New
   eval case" (opens the shared EvalCaseEditor), and a link out to the full
   per-agent dashboard.

   Per-case pass/fail note: `useEvalCases` returns `EvalCaseWithLatestRun[]`
   (each case carries its own most recent PERSISTED `eval_runs` row, via
   `EvalService.listCasesForAgent` → `EvalRepository.latestRunForCase`) — so
   a case that passed/failed in a PAST session still shows correctly after a
   reload. A run triggered THIS session (kept in `sessionResults` local
   state) always wins over the persisted one, same fallback order as
   EvalCaseEditor's own status strip (`stripDataFromResult` ??
   `stripDataFromRecord`). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CategoryTag,
  EmptyState,
  Icon,
  MetricCard,
  SeverityBadge,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, EvalCase, EvalCaseWithLatestRun, EvalRunResult } from "@devdigest/shared";
import { useAgentEvalDashboard, useDeleteEvalCase, useEvalCases, useRunEvalBatch } from "@/lib/hooks/eval";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";
import {
  casePassState,
  countActual,
  deltaPercentPoints,
  expectedCount,
  formatPercent,
  highestSeverityBadge,
  runFailureBreakdown,
  toRunRecord,
} from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: dashboard, isLoading: dashboardLoading } = useAgentEvalDashboard(agent.id);
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const runAll = useRunEvalBatch(agent.id);

  // In-session "latest run" per case id — see the file header note on why
  // this can't be sourced from `useEvalCases` itself.
  const [sessionResults, setSessionResults] = React.useState<Record<string, EvalRunResult>>({});
  const mergeResults = React.useCallback((results: EvalRunResult[]) => {
    setSessionResults((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.case_id] = r;
      return next;
    });
  }, []);

  const [editorState, setEditorState] = React.useState<{ evalCase: EvalCase | null } | null>(null);

  async function handleRunAll() {
    // AC-40 / AC-28: `case_ids` omitted/empty = every case in the set (the
    // contract's own convention — same as the workspace dashboard's own
    // "Run all agents", but scoped to this one agent's set).
    const response = await runAll.mutateAsync({});
    mergeResults(response.results);
  }

  const editorLatestRun =
    editorState?.evalCase && sessionResults[editorState.evalCase.id]
      ? toRunRecord(sessionResults[editorState.evalCase.id]!, editorState.evalCase)
      : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
        <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>
      </div>

      {dashboardLoading ? (
        <div style={s.tiles}>
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
      ) : dashboard ? (
        <div style={s.tiles}>
          <MetricCard
            label={t("dashboard.metrics.recall")}
            value={formatPercent(dashboard.current.recall)}
            delta={deltaPercentPoints(dashboard.delta.recall)}
            color="var(--accent)"
          />
          <MetricCard
            label={t("dashboard.metrics.precision")}
            value={formatPercent(dashboard.current.precision)}
            delta={deltaPercentPoints(dashboard.delta.precision)}
            color="var(--ok)"
          />
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={formatPercent(dashboard.current.citation_accuracy)}
            delta={deltaPercentPoints(dashboard.delta.citation_accuracy)}
            color="var(--warn)"
          />
          {/* `EvalDashboard` carries no `traces_passed` delta field — raw
             current value only, no delta badge, per this tab's spec. */}
          <MetricCard
            label={t("dashboard.metrics.tracesPassed")}
            value={`${dashboard.current.traces_passed}/${dashboard.current.traces_total}`}
          />
        </div>
      ) : null}

      <div style={s.actions}>
        <Button kind="primary" icon="Play" onClick={handleRunAll} loading={runAll.isPending}>
          {runAll.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
        </Button>
        <Button kind="secondary" icon="Plus" onClick={() => setEditorState({ evalCase: null })}>
          {t("evalsTab.newCase")}
        </Button>
        <Link href={`/eval/${agent.id}`} style={s.dashboardLink}>
          {t("evalsTab.viewDashboard")}
        </Link>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h3 style={{ ...s.h3, marginBottom: 0 }}>{t("evalsTab.casesHeading")}</h3>
          {cases && cases.length > 0 && (
            <Badge>
              {t("evalsTab.casesPassing", {
                passed: cases.filter((c) => casePassState(c, sessionResults[c.id]) === true).length,
                total: cases.length,
              })}
            </Badge>
          )}
        </div>
        {casesLoading ? (
          <div style={s.list}>
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        ) : !cases || cases.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
        ) : (
          <div style={s.list}>
            {cases.map((c) => (
              <CaseRow
                key={c.id}
                evalCase={c}
                agentId={agent.id}
                result={sessionResults[c.id]}
                onRan={(result) => mergeResults([result])}
                onEdit={() => setEditorState({ evalCase: c })}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {editorState && (
        <EvalCaseEditor
          agentId={agent.id}
          agentName={agent.name}
          evalCase={editorState.evalCase}
          latestRun={editorLatestRun}
          onClose={() => setEditorState(null)}
          onSaved={() => setEditorState(null)}
        />
      )}
    </div>
  );
}

function CaseRow({
  evalCase,
  agentId,
  result,
  onRan,
  onEdit,
  t,
}: {
  evalCase: EvalCaseWithLatestRun;
  agentId: string;
  result: EvalRunResult | undefined;
  onRan: (result: EvalRunResult) => void;
  onEdit: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const runOne = useRunEvalBatch(agentId);
  const del = useDeleteEvalCase(evalCase.id);

  async function handleRun() {
    const response = await runOne.mutateAsync({ case_ids: [evalCase.id] });
    const own = response.results.find((r) => r.case_id === evalCase.id);
    if (own) onRan(own);
  }

  // A run triggered THIS session always wins; otherwise fall back to the
  // case's own persisted latest run (survives a page reload); otherwise
  // truly "never run" (neutral icon). Same fallback order as
  // EvalCaseEditor's `strip` (`freshRun ?? stripDataFromRecord(...)`).
  const persisted = evalCase.latest_run;
  const pass = casePassState(evalCase, result);
  const StatusIcon = pass == null ? Icon.Dot : pass ? Icon.CheckCircle : Icon.XCircle;
  const statusColor = pass == null ? "var(--text-muted)" : pass ? "var(--ok)" : "var(--crit)";
  const statusLabel =
    pass == null ? t("evalsTab.neverRun") : pass ? t("evalsTab.passed") : t("evalsTab.failed");
  const got = result
    ? countActual(result.result.per_trace[0]?.actual)
    : persisted
      ? countActual(persisted.actual_output)
      : null;
  const breakdown = result
    ? runFailureBreakdown(result.result.per_trace)
    : persisted
      ? runFailureBreakdown(persisted.actual_output)
      : null;
  const badge = highestSeverityBadge(evalCase.expected_output);

  return (
    <div data-testid={`eval-case-row-${evalCase.id}`}>
      <Card>
        <div style={s.row}>
          <span style={{ ...s.rowStatus, color: statusColor }}>
            <StatusIcon size={16} />
            <span style={s.rowStatusLabel}>{statusLabel}</span>
          </span>
          <div style={s.rowMain}>
            <div style={s.rowName}>{evalCase.name}</div>
            <div style={s.rowSubtitle}>
              {t("evalsTab.caseSubtitle", { expected: expectedCount(evalCase), got: got ?? "—" })}
            </div>
            {pass === false && breakdown && (
              <div style={s.rowSubtitle}>
                {t("evalsTab.caseFailureBreakdown", {
                  missed: breakdown.missed,
                  falsePositives: breakdown.falsePositives,
                  extra: breakdown.extra,
                })}
              </div>
            )}
          </div>
          {badge && (
            <span style={s.rowBadge}>
              <SeverityBadge severity={badge.severity} />
              {badge.category && <CategoryTag category={badge.category} />}
            </span>
          )}
          <div style={s.rowActions}>
            <Button kind="ghost" size="sm" icon="Play" onClick={handleRun} loading={runOne.isPending}>
              {runOne.isPending ? t("evalsTab.running") : t("evalsTab.run")}
            </Button>
            <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit}>
              {t("evalsTab.edit")}
            </Button>
            <Button kind="ghost" size="sm" icon="Trash" onClick={() => del.mutate()} loading={del.isPending}>
              {t("evalsTab.delete")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
