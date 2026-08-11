/* MultiAgentFindingCard — the collapsible finding card of Tabs mode
   (AC-48 – AC-51).

   Route-local on purpose: the PR page's `FindingCard` is owned by another
   surface and its collapsed row differs from this screen's. AC-50 requires the
   same ENDPOINTS through the existing hooks, not the same component — so
   Accept/Dismiss go through `useFindingAction()` and "Turn into eval case"
   through `useCreateEvalCaseFromFinding()`, exactly as the PR page does. No new
   endpoint is called, and `Learn` reaches no server at all. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  CategoryTag,
  ConfidenceNum,
  Icon,
  Markdown,
  MonoLink,
  SeverityBadge,
  SEV,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { EvalCase, FindingRecord } from "@devdigest/shared";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/eval";
import { s } from "./styles";

function lineLabel(f: FindingRecord): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}

export function MultiAgentFindingCard({
  finding,
  prId,
  agentId,
}: {
  finding: FindingRecord;
  prId: string;
  /** The producing lane's agent id — an eval case needs an owner to attach to. */
  agentId: string | null;
}) {
  const t = useTranslations("multiAgent");
  const [expanded, setExpanded] = React.useState(false);
  const [newEvalCase, setNewEvalCase] = React.useState<EvalCase | null>(null);
  const act = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();

  const sev = SEV[finding.severity as Severity] ?? SEV.INFO;
  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  // An accepted/dismissed finding stays visible, carrying its state — it is
  // never removed from the document (spec edge case).
  const muted = accepted || dismissed;

  return (
    <>
      <div data-finding-id={finding.id} style={s.card(sev.c, muted)}>
        <div onClick={() => setExpanded((e) => !e)} style={s.cardHeader}>
          <div style={{ paddingTop: 1 }}>
            <SeverityBadge severity={finding.severity as Severity} compact />
          </div>
          <div style={s.cardMain}>
            <div style={s.cardTitleRow}>
              <span style={s.cardTitle(muted)}>{finding.title}</span>
              <CategoryTag category={finding.category as Category} />
            </div>
            <div style={s.cardMetaRow}>
              <MonoLink>
                {finding.file}:{lineLabel(finding)}
              </MonoLink>
              <ConfidenceNum value={finding.confidence} />
            </div>
          </div>
          <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
        </div>

        {expanded && (
          <div style={s.cardBody}>
            <div style={s.prose}>
              <Markdown>{finding.rationale}</Markdown>
            </div>
            {finding.suggestion && (
              <div style={s.fixWrap}>
                <div style={s.fixLabel}>{t("result.suggestedFix")}</div>
                <div style={s.prose}>
                  <Markdown>{finding.suggestion}</Markdown>
                </div>
              </div>
            )}

            <div style={s.actions}>
              <Button
                kind="secondary"
                size="sm"
                icon="Check"
                active={accepted}
                disabled={act.isPending}
                onClick={() => act.mutate({ findingId: finding.id, action: "accept", prId })}
              >
                {t("result.actions.accept")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                active={dismissed}
                disabled={act.isPending}
                onClick={() => act.mutate({ findingId: finding.id, action: "dismiss", prId })}
              >
                {t("result.actions.dismiss")}
              </Button>
              {/* AC-51 — present but programmatically disabled, tooltipped, and
                  wired to nothing: it arrives with the Memory feature. */}
              <Button
                kind="ghost"
                size="sm"
                icon="Brain"
                disabled
                title={t("result.learnTooltip")}
              >
                {t("result.actions.learn")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={agentId == null || createEvalCase.isPending}
                loading={createEvalCase.isPending}
                onClick={() =>
                  createEvalCase.mutate(finding.id, { onSuccess: (created) => setNewEvalCase(created) })
                }
              >
                {t("result.actions.evalCase")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* SIBLING of the card root, never a descendant: the card dims itself with
         `opacity` once the finding is accepted/dismissed, and CSS opacity
         applies to a `position: fixed` descendant too (client/INSIGHTS.md
         2026-07-30). */}
      {newEvalCase && (
        <EvalCaseEditor
          agentId={agentId ?? ""}
          evalCase={newEvalCase}
          onClose={() => setNewEvalCase(null)}
        />
      )}
    </>
  );
}
