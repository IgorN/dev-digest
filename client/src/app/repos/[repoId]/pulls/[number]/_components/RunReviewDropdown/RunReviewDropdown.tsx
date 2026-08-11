/* RunReviewDropdown — the PR-page multi-agent picker.
   Design source: design-src/components2.jsx, `RunReviewDropdown` :24-65.

   The trigger stays the toolbar's existing `Run Review` button, so the PR
   toolbar keeps exactly three buttons (AC-21a); opening it drops a panel with
   one checkbox row per ENABLED agent, all pre-checked, and a count-aware launch
   button that POSTs the explicit agent set and navigates to the resulting
   multi-run result page (AC-32).

   Re-entry into an EXISTING multi-run is deliberately NOT here — it lives in
   the PR timeline (RunHistory), because this control launches and that one
   only navigates. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { useAgentEstimates } from "@/lib/hooks/multi-runs";
import { AGENTS_HREF, multiRunHref } from "./constants";
import { durationHint, estimatesByAgent, toggleId } from "./helpers";
import { s, boxStyle, rowStyle } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const tm = useTranslations("multiAgent");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const run = useRunReview();

  const [open, setOpen] = React.useState(false);
  // `null` means "nothing touched yet" → every enabled agent is selected. Kept
  // as a distinct state (rather than seeding an array) because the agent list
  // arrives asynchronously: the panel must still open fully checked when the
  // agents resolve after it was opened. An explicit `[]` is the cleared state.
  const [picked, setPicked] = React.useState<string[] | null>(null);

  // AC-17: only ENABLED agents. This narrows the previous control, which
  // deliberately listed disabled agents too so one could be run ad hoc.
  const enabled = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const enabledIds = React.useMemo(() => enabled.map((a) => a.id), [enabled]);
  const selected = React.useMemo(
    () => (picked ?? enabledIds).filter((id) => enabledIds.includes(id)),
    [picked, enabledIds],
  );
  const estimateOf = React.useMemo(() => estimatesByAgent(estimates), [estimates]);

  const allSelected = enabledIds.length > 0 && selected.length === enabledIds.length;
  const count = selected.length;

  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const toggleOpen = () => {
    // Re-opening always starts from "all enabled checked".
    if (!open) setPicked(null);
    setOpen(!open);
  };

  const launch = async () => {
    if (count === 0) return;
    setOpen(false);
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentIds: selected });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      if (res.multi_run_id) router.push(multiRunHref(res.multi_run_id));
    } finally {
      onRunSettled?.();
    }
  };

  const runLabel =
    count === 0
      ? tm("picker.runNone")
      : count === 1
        ? tm("picker.runOne", { agent: enabled.find((a) => a.id === selected[0])?.name ?? "" })
        : tm("picker.run", { count });

  return (
    <div ref={panelRef} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          icon="Sparkles"
          iconRight="ChevronDown"
          loading={run.isPending}
          onClick={toggleOpen}
        >
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {open && (
        <div style={s.panel}>
          <div style={s.header}>
            <span style={s.headerLabel}>{tm("picker.heading")}</span>
            <button
              type="button"
              style={s.headerLink}
              onClick={() => setPicked(allSelected ? [] : enabledIds)}
            >
              {allSelected ? tm("picker.clear") : tm("picker.selectAll")}
            </button>
          </div>

          {warnMerged && (
            <div style={s.warning}>
              <Icon.AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span>{t("runReview.mergedWarning")}</span>
            </div>
          )}

          {enabled.length === 0 ? (
            <div style={s.empty}>{tm("picker.empty")}</div>
          ) : (
            enabled.map((a) => (
              <AgentRow
                key={a.id}
                name={a.name}
                checked={selected.includes(a.id)}
                hint={durationHint(estimateOf.get(a.id), tm("picker.noEstimate"))}
                onToggle={() => setPicked(toggleId(selected, a.id))}
              />
            ))
          )}

          <div style={s.launchWrap}>
            <Button
              kind="primary"
              size="sm"
              icon={count > 1 ? "Users" : "Play"}
              disabled={count === 0}
              onClick={launch}
              style={s.launchButton}
            >
              {runLabel}
            </Button>
          </div>

          <button
            type="button"
            style={s.footer}
            onClick={() => {
              setOpen(false);
              router.push(AGENTS_HREF);
            }}
          >
            <Icon.Settings size={13} />
            {tm("picker.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One agent row. The whole row IS the checkbox (`role="checkbox"` +
 * `aria-checked` + an `aria-label` carrying the agent name) so the entire
 * 288px-wide strip is the hit target the design shows while the control still
 * has a programmatic name and state (WCAG 2.1 AA). The 16×16 square inside is
 * decoration only.
 */
function AgentRow({
  name,
  checked,
  hint,
  onToggle,
}: {
  name: string;
  checked: boolean;
  hint: string;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={name}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={rowStyle(hovered)}
    >
      <span aria-hidden style={boxStyle(checked)}>
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </span>
      <Icon.Cpu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={s.rowName}>{name}</span>
      <span className="mono" style={s.rowHint}>
        {hint}
      </span>
    </button>
  );
}
