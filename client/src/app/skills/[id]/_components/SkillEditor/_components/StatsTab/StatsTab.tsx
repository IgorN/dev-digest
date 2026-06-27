/* Stats tab — where this skill is used: the agents that link it. (A skill has no
   runs of its own; its impact is measured through the agents that carry it.) */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Badge, Skeleton, EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillUsage } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: usage, isLoading } = useSkillUsage(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }
  if (!usage || usage.agent_count === 0) {
    return <EmptyState icon="BarChart" title={t("stats.emptyTitle")} body={t("stats.emptyBody")} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.metric}>
        <span style={s.metricNum}>{usage.agent_count}</span>
        <span style={s.metricLabel}>{t("stats.usedBy", { count: usage.agent_count })}</span>
      </div>
      <div style={s.list}>
        {usage.agents.map((a) => (
          <button key={a.id} style={s.row} onClick={() => router.push(`/agents/${a.id}?tab=skills`)}>
            <Icon.Cpu size={15} style={{ color: "var(--accent)" }} />
            <span style={s.name}>{a.name}</span>
            <Badge color="var(--text-muted)">
              {t("stats.order", { order: a.order + 1 })}
            </Badge>
            {!a.enabled && <Badge color="var(--text-muted)">{t("stats.agentDisabled")}</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}
