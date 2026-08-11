/* ConfigureRunView — the Configure-run form (AC-22 – AC-32).

   Rendered by TWO segments: `/multi-agent-review/configure` (always, AC-22c)
   and `/multi-agent-review` when the active repository has no previous
   multi-run (AC-22). It therefore lives at the route-tree `_components/`, and
   it NEVER consults the latest-multi-run resolver itself — that branch belongs
   to EntryPointView alone.

   Structure + styling ported from the design gallery's `RunConfig`
   (design-src/screen_multiagent.jsx:107). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, Icon, type DropdownItemDef } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates } from "@/lib/hooks/multi-runs";
import { useRunReview } from "@/lib/hooks/reviews";
import { accentForIndex, formatDurationMs, formatUsd } from "../helpers";
import { AgentPickCard } from "./AgentPickCard";
import { aggregateEstimate, byAgentId } from "./helpers";
import { s } from "./styles";

const PR_DROPDOWN_WIDTH = 420;

export function ConfigureRunView() {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { repoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const run = useRunReview();

  const [prId, setPrId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);

  // AC-23: every pull request of the active repository. Deliberately NOT
  // filtered by status — the design source drops `stale` PRs, which would hide
  // real, reviewable pull requests (and the repo's own verification PR).
  const prList = (pulls ?? []).filter((p) => !!p.id);
  const pr = prList.find((p) => p.id === prId) ?? null;
  const enabledAgents = (agents ?? []).filter((a) => a.enabled);
  const estimateById = byAgentId(estimates ?? []);
  const allSelected = enabledAgents.length > 0 && selected.length === enabledAgents.length;
  const aggregate = aggregateEstimate(estimateById, selected);

  const toggleAgent = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const prItems: DropdownItemDef[] = prList.length
    ? prList.map((p) => ({
        label: t("configure.prItem", { number: p.number, title: p.title }),
        icon: "GitPullRequest" as const,
        onClick: () => setPrId(p.id ?? null),
      }))
    : [{ label: t("configure.noPrs"), muted: true }];

  const launch = () => {
    if (!prId || selected.length === 0) return;
    run.mutate(
      { prId, agentIds: selected },
      {
        onSuccess: (res) => {
          if (res.multi_run_id) router.push(`/multi-agent-review/${res.multi_run_id}`);
        },
      },
    );
  };

  // Conditional label, per the design source: it stays informative at N = 1
  // while still satisfying AC-19's live count at N ≥ 2 and AC-20's disabled-at-0.
  const runLabel =
    selected.length > 1
      ? t("configure.run", { count: selected.length })
      : selected.length === 1
        ? t("configure.runOne")
        : t("configure.runNone");

  return (
    <AppShell crumb={[{ label: t("configure.breadcrumbRoot") }, { label: t("configure.breadcrumb") }]}>
      <div style={s.page}>
        <h1 style={s.h1}>{t("configure.title")}</h1>
        <p style={s.subtitle}>{t("configure.subtitle")}</p>

        {/* Step 1 — pull request */}
        <div style={s.stepRow}>
          <span style={s.stepCircle(true)}>1</span>
          <span style={s.stepLabel(true)}>{t("configure.step1")}</span>
        </div>
        <div style={s.stepBody}>
          <Dropdown
            width={PR_DROPDOWN_WIDTH}
            align="left"
            items={prItems}
            trigger={
              <Button kind="secondary" icon="GitPullRequest" iconRight="ChevronDown">
                {pr ? t("configure.prItem", { number: pr.number, title: pr.title }) : t("configure.selectPr")}
              </Button>
            }
          />
        </div>

        {/* Step 2 — agents, gated on a chosen PR */}
        <div style={s.stepRow}>
          <span style={s.stepCircle(!!pr)}>2</span>
          <span style={s.stepLabel(!!pr)}>{t("configure.step2")}</span>
          {pr && (
            <button
              type="button"
              style={s.selectAllLink}
              onClick={() => setSelected(allSelected ? [] : enabledAgents.map((a) => a.id))}
            >
              {allSelected ? t("configure.clearAll") : t("configure.selectAll")}
            </button>
          )}
        </div>

        {pr ? (
          <div style={s.agentList}>
            {enabledAgents.map((agent, i) => (
              <AgentPickCard
                key={agent.id}
                agent={agent}
                estimate={estimateById.get(agent.id)}
                accent={accentForIndex(i)}
                selected={selected.includes(agent.id)}
                onToggle={() => toggleAgent(agent.id)}
              />
            ))}
          </div>
        ) : (
          <div style={s.gate}>
            <div style={s.gateIcon}>
              <Icon.GitPullRequest size={21} style={{ color: "var(--text-muted)" }} />
            </div>
            <div style={s.gateTitle}>{t("configure.emptyTitle")}</div>
            <p style={s.gateBody}>{t("configure.emptyBody")}</p>
          </div>
        )}

        <div style={s.runBar}>
          <Button
            kind="primary"
            icon="Users"
            disabled={!pr || selected.length === 0}
            loading={run.isPending}
            onClick={launch}
          >
            {runLabel}
          </Button>
          {pr && selected.length > 0 && (
            <span className="mono" style={s.aggregate}>
              {t("configure.aggregate", {
                duration: formatDurationMs(aggregate.durationMs),
                cost: formatUsd(aggregate.costUsd),
              })}
            </span>
          )}
        </div>
      </div>
    </AppShell>
  );
}
