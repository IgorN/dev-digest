/* AgentPickCard — one selectable agent on the Configure-run form (AC-28/AC-29).
   Ported from the design gallery's `PersonaPickCard` (screen_multiagent.jsx:93).

   The whole card IS the checkbox (`role="checkbox"` + `aria-checked` on the
   button itself) rather than nesting the `@devdigest/ui` Checkbox inside a
   button — nested interactive elements are invalid, and the primitive renders
   no accessible name of its own anyway. An explicit `aria-label` carries the
   agent name so the control is named for AT and addressable in tests. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { Agent, AgentRunEstimate } from "@devdigest/shared";
import { AGENT_ICON } from "../constants";
import { formatDurationMs, formatUsd } from "../helpers";
import { s } from "./styles";

export function AgentPickCard({
  agent,
  estimate,
  accent,
  selected,
  onToggle,
}: {
  agent: Agent;
  estimate: AgentRunEstimate | undefined;
  accent: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const AgentGlyph = Icon[AGENT_ICON];
  // AC-28: omit the line entirely when the agent has never produced a review —
  // never placeholder text.
  const summary = estimate?.last_summary?.trim() || null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={agent.name}
      onClick={onToggle}
      style={s.card(selected, accent)}
    >
      <span style={s.cardCheck(selected, accent)}>
        {selected && <Icon.Check size={12} style={{ color: "#fff" }} />}
      </span>
      <span style={s.cardIcon(accent)}>
        <AgentGlyph size={16} />
      </span>
      <span style={s.cardMain}>
        <span style={{ ...s.cardName, display: "block" }}>{agent.name}</span>
        {summary && <span style={{ ...s.cardSummary, display: "block" }}>{summary}</span>}
      </span>
      <span className="mono" style={s.cardMeta}>
        {formatDurationMs(estimate?.avg_duration_ms)} · {formatUsd(estimate?.avg_cost_usd)}
      </span>
    </button>
  );
}
