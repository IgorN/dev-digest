/* CiRunsFilters — the design's five-chip filter row (screen_cizruns.jsx:29-34):
   date range, agent, repository, status, source.

   The agent and repository options come from the facets the runs request
   returns in the SAME round trip (`CiRunsResponse.agents` / `.repos`), so the
   chip row never costs a second request. The date chip is a toggle rather than
   a picker because the frozen `ci` namespace ships exactly one range label. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Dropdown, type DropdownItemDef } from "@devdigest/ui";
import type { CiRunsFilters as Filters } from "@/lib/hooks/ci-runs";
import { DATE_RANGE_DAYS, STATUS_META, STATUS_OPTIONS } from "../../constants";
import { statusMeta } from "../../helpers";
import { s } from "../../styles";

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  agents: { id: string; name: string }[];
  repos: string[];
  sources: string[];
}

export function CiRunsFilters({ filters, onChange, agents, repos, sources }: Props) {
  const t = useTranslations("ci");

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  const agentName = agents.find((a) => a.id === filters.agent_id)?.name;

  const agentItems: DropdownItemDef[] = [
    { label: t("runs.filters.allAgents"), muted: !filters.agent_id, onClick: () => set("agent_id", null) },
    ...agents.map((a) => ({ label: a.name, onClick: () => set("agent_id", a.id) })),
  ];
  const repoItems: DropdownItemDef[] = [
    { label: t("runs.filters.allRepos"), muted: !filters.repo, onClick: () => set("repo", null) },
    ...repos.map((r) => ({ label: r, onClick: () => set("repo", r) })),
  ];
  const statusItems: DropdownItemDef[] = [
    { label: t("runs.filters.allStatuses"), muted: !filters.status, onClick: () => set("status", null) },
    ...STATUS_OPTIONS.map((st) => ({
      label: t(`runs.status.${STATUS_META[st].messageKey}`),
      onClick: () => set("status", st),
    })),
  ];
  const sourceItems: DropdownItemDef[] = [
    { label: t("runs.filters.allSources"), muted: !filters.source, onClick: () => set("source", null) },
    ...sources.map((src) => ({ label: src, onClick: () => set("source", src) })),
  ];

  const selectedStatus = statusMeta(filters.status);
  const statusLabel = selectedStatus
    ? t(`runs.status.${selectedStatus.messageKey}`)
    : t("runs.filters.allStatuses");

  return (
    <div style={s.filters}>
      <Chip
        icon="Calendar"
        active={filters.days != null}
        onClick={() => set("days", filters.days == null ? DATE_RANGE_DAYS : null)}
      >
        {t("runs.filters.last7Days")}
      </Chip>
      <Dropdown
        trigger={
          <Chip icon="Cpu" active={!!filters.agent_id}>
            {agentName ?? t("runs.filters.allAgents")}
          </Chip>
        }
        items={agentItems}
      />
      <Dropdown
        trigger={
          <Chip icon="GitBranch" active={!!filters.repo}>
            {filters.repo ?? t("runs.filters.allRepos")}
          </Chip>
        }
        items={repoItems}
      />
      <Dropdown
        trigger={<Chip active={!!filters.status}>{statusLabel}</Chip>}
        items={statusItems}
      />
      <Dropdown
        trigger={
          <Chip icon="Workflow" active={!!filters.source}>
            {filters.source ?? t("runs.filters.allSources")}
          </Chip>
        }
        items={sourceItems}
      />
    </div>
  );
}
