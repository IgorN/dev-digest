/* MultiRunView — the multi-run result page in both modes (AC-32 – AC-42).

   Takes a `multiRunId` prop and lives at the route-tree `_components/` because
   TWO segments render it: `/multi-agent-review/[multiRunId]` (the explicit,
   shareable address) and `/multi-agent-review` when the active repository has a
   previous multi-run (AC-22a).

   Live state is rebuilt from the fetched document on every load, so a reload
   mid-fan-out resumes exactly where it left off; `useMultiRun`'s bounded
   `refetchInterval` refreshes while any lane is non-terminal (AC-37) and stops
   entirely once they all settle (AC-38).

   Structure + styling ported from the design gallery's `ScreenMultiAgent`
   (design-src/screen_multiagent.jsx:150). ONE thing in that source is stale and
   is deliberately not copied: `MetaRow` (:49) reads "fan-out via worktrees" —
   this pipeline uses no worktrees, and the sub-row reads "parallel fan-out". */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/RunTraceDrawer";
import { ApiError } from "@/lib/api";
import { isTerminalRunStatus, useMultiRun } from "@/lib/hooks/multi-runs";
import { CONFIGURE_HREF } from "../constants";
import { formatDurationMs, formatUsd } from "../helpers";
import { ColumnsView } from "./_components/ColumnsView";
import { ConflictsSection } from "./_components/ConflictsSection";
import { TabsView } from "./_components/TabsView";
import { s } from "./styles";

type ViewMode = "columns" | "tabs";

export function MultiRunView({ multiRunId }: { multiRunId: string }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useMultiRun(multiRunId);
  const [view, setView] = React.useState<ViewMode>("columns");
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);

  const goConfigure = () => router.push(CONFIGURE_HREF);
  const rootCrumb = { label: t("result.crumbRoot") };

  if (isLoading) {
    return (
      <AppShell crumb={[rootCrumb]}>
        <div style={s.loading}>
          <Skeleton height={28} width={320} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    // AC-64 — an unresolvable or cross-workspace id is a 404, and reads as a
    // "not found" page rather than a transport error.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <AppShell crumb={[rootCrumb]}>
        {notFound ? (
          <EmptyState
            icon="Cpu"
            title={t("result.notFound.title")}
            body={t("result.notFound.body")}
            cta={t("result.notFound.cta")}
            onCta={goConfigure}
          />
        ) : (
          <ErrorState onRetry={() => refetch()} />
        )}
      </AppShell>
    );
  }

  const agents = data.agents;
  const traceAgent = agents.find((a) => a.run_id === traceRunId) ?? null;

  return (
    <AppShell crumb={[rootCrumb, { label: `#${data.pr.number}`, mono: true }]}>
      <div style={s.toolbar}>
        {/* AC-33a — the single path from a result back to launching another run.
            It targets the EXPLICIT configure address, never the entry point,
            which would bounce the user straight back to this result. */}
        <button type="button" style={s.configureBtn} title={t("result.configureRunTooltip")} onClick={goConfigure}>
          <Icon.Settings size={14} />
          {t("result.configureRun")}
        </button>
        <h1 style={s.h1}>{t("result.title")}</h1>
        <span style={s.selectedAgents}>{t("result.selectedAgents", { count: agents.length })}</span>
        <div style={s.segmented}>
          {(["columns", "tabs"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => setView(k)}
              style={s.segment(view === k)}
            >
              {k === "columns" ? t("result.viewColumns") : t("result.viewTabs")}
            </button>
          ))}
        </div>
      </div>

      <div style={s.metaRow}>
        <span className="mono" style={s.metaNumber}>
          #{data.pr.number}
        </span>
        <span style={s.metaTitle}>{data.pr.title}</span>
        <span style={s.metaSummary}>
          <Icon.Cpu size={14} style={{ color: "var(--accent)" }} />
          {t("result.subRow", {
            count: data.totals.agent_count,
            duration: formatDurationMs(data.totals.max_duration_ms),
            cost: formatUsd(data.totals.total_cost_usd),
          })}
        </span>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon="Cpu"
          title={t("result.empty.title")}
          body={t("result.empty.body")}
          cta={t("result.empty.cta")}
          onCta={goConfigure}
        />
      ) : (
        <>
          {view === "columns" ? (
            <ColumnsView agents={agents} onViewTrace={setTraceRunId} />
          ) : (
            <TabsView agents={agents} prId={data.pr.id} onViewTrace={setTraceRunId} />
          )}
          {/* AC-53 — rendered below the results in BOTH modes. */}
          <div style={s.conflictsWrap}>
            <ConflictsSection groups={data.groups} agents={agents} />
          </div>
        </>
      )}

      {/* AC-39/AC-40 — the SAME drawer the PR page mounts, scoped to the lane
         that asked for it. Rendered at the shell level, never inside a card. */}
      {traceAgent && (
        <RunTraceDrawer
          runId={traceAgent.run_id}
          agentName={traceAgent.agent_name}
          prNumber={data.pr.number}
          findings={traceAgent.findings}
          running={!isTerminalRunStatus(traceAgent.status)}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
