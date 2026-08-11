/* TabsView — per-agent deep dive (AC-46 – AC-49).
   Ported from the design gallery's `TabsView` (screen_multiagent.jsx:67). The
   tab bar is hand-rolled rather than reusing the `@devdigest/ui` Tabs kit
   because the active underline must take that agent's POSITIONAL accent
   (AC-46/AC-52), where the kit hardcodes `var(--accent)`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink } from "@devdigest/ui";
import type { MultiRunAgent } from "@devdigest/shared";
import { AGENT_ICON } from "../../../constants";
import { accentForIndex, formatDurationMs, formatUsd } from "../../../helpers";
import { scoreBandColor, statusKey } from "../../helpers";
import { MultiAgentFindingCard } from "./MultiAgentFindingCard";
import { s } from "./styles";

export function TabsView({
  agents,
  prId,
  onViewTrace,
}: {
  agents: MultiRunAgent[];
  prId: string;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const [selected, setSelected] = React.useState(0);
  const AgentGlyph = Icon[AGENT_ICON];

  // Clamp rather than store: the document can shrink between refreshes.
  const index = Math.min(selected, agents.length - 1);
  const agent = agents[index];
  if (!agent) return null;
  const accent = accentForIndex(index);
  const sk = statusKey(agent.status);

  return (
    <div>
      <div style={s.tabBar} role="tablist">
        {agents.map((a, i) => {
          const on = i === index;
          return (
            <button
              key={a.run_id}
              role="tab"
              aria-selected={on}
              onClick={() => setSelected(i)}
              style={s.tab(on, accentForIndex(i))}
            >
              <AgentGlyph size={15} style={{ color: on ? accentForIndex(i) : "var(--text-muted)" }} />
              <span style={s.tabName(on)}>{a.agent_name}</span>
              {a.score != null && (
                <span className="tnum" style={s.tabScore(scoreBandColor(a.score))}>
                  {a.score}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={s.content}>
        <div style={s.summaryCard(accent)}>
          {agent.score != null ? (
            <CircularScore score={agent.score} size={44} />
          ) : (
            <Icon.Cpu size={22} style={{ color: accent, flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={s.summaryName(accent)}>{agent.agent_name}</div>
            <p style={s.summaryText}>{agent.summary || t("result.noSummary")}</p>
          </div>
          <div style={s.summaryRight}>
            <MonoLink onClick={() => onViewTrace(agent.run_id)}>{t("result.viewTrace")}</MonoLink>
            <span className="mono tnum" style={s.summaryMeta}>
              {sk && `${t(`result.status.${sk}`)} · `}
              {formatDurationMs(agent.duration_ms)} · {formatUsd(agent.cost_usd)}
            </span>
          </div>
        </div>

        <div style={s.list}>
          {agent.findings.length === 0 ? (
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("result.noFindings")}</span>
          ) : (
            agent.findings.map((f) => (
              <MultiAgentFindingCard key={f.id} finding={f} prId={prId} agentId={agent.agent_id} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
