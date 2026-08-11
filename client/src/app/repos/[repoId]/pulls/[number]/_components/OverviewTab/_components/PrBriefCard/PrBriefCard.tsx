/* PrBriefCard — the "Why + Risk Brief": a synthesized what/why/risk-level
   verdict assembled from Intent, Blast Radius, Smart Diff, the linked issue,
   and Context-Folder docs via exactly one model call, cached per PR. Same
   three states as IntentCard/BlastCard: loading, not-yet-computed
   (EmptyState + recompute CTA), and populated. A `degraded` brief still
   renders its available content plus an explanatory badge + reason, never a
   blank screen (AC-18). Risk level is always colour + a translated text
   label (AC-15). Only review_focus items get the jump affordance — a risk's
   file_refs render as plain muted mono text, never clickable (AC-16's exact
   scope). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, EmptyState, Button, Skeleton, Badge, Icon, MonoLink } from "@devdigest/ui";
import { RunCostBadge } from "@/components/RunCostBadge";
import { useWhyRiskBrief, useRecomputeWhyRiskBrief } from "@/lib/hooks/why-risk-brief";
import type { Risk, ReviewFocusItem } from "@/lib/types";
import { RISK_LEVEL } from "./helpers";
import { s, chevronStyle } from "./styles";

export function PrBriefCard({
  prId,
  onJumpToCode,
}: {
  prId: string | null;
  /** Paths this PR's diff actually contains. Accepted for prop-shape parity
     with BlastCard (same signature convention across Overview cards) — the
     in-diff-scroll-vs-GitHub-blob branching itself already lives inside the
     shared onJumpToCode callback (page.tsx's handleJumpToCode), so every
     jump control that calls it gets that behavior for free (AC-16). */
  diffPaths: ReadonlySet<string>;
  onJumpToCode: (path: string, line: number) => void;
}) {
  const t = useTranslations("brief");
  const { data: brief, isLoading } = useWhyRiskBrief(prId);
  const recompute = useRecomputeWhyRiskBrief(prId);

  return (
    <section>
      <SectionLabel icon="Shield">{t("block.whyRisk")}</SectionLabel>
      <Card>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={16} width={280} />
            <Skeleton height={80} />
          </div>
        ) : !brief ? (
          <EmptyState
            icon="Shield"
            title={t("unavailable")}
            body={t("unavailableHint")}
            cta={recompute.isPending ? t("card.recomputing") : t("card.recompute")}
            onCta={() => recompute.mutate()}
            ctaLoading={recompute.isPending}
          />
        ) : (
          <>
            <div style={s.headerRow}>
              <div style={s.headerLeft}>
                <Badge
                  icon={RISK_LEVEL[brief.risk_level].icon}
                  color={RISK_LEVEL[brief.risk_level].c}
                  bg={RISK_LEVEL[brief.risk_level].bg}
                >
                  {t(`riskLevel.${brief.risk_level}`)}
                </Badge>
                {brief.cost_usd != null && (
                  <RunCostBadge
                    costUsd={brief.cost_usd}
                    tokensIn={brief.tokens_in}
                    tokensOut={brief.tokens_out}
                    variant="full"
                  />
                )}
              </div>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                onClick={() => recompute.mutate()}
                loading={recompute.isPending}
              >
                {recompute.isPending ? t("card.recomputing") : t("card.recompute")}
              </Button>
            </div>

            {brief.degraded && (
              <div style={s.degraded}>
                <div style={s.degradedHead}>
                  <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                    {t("degradedBadge")}
                  </Badge>
                </div>
                {brief.degraded_reason && <p style={s.degradedReason}>{brief.degraded_reason}</p>}
              </div>
            )}

            <Field label={t("field.what")} text={brief.what} />
            <Field label={t("field.why")} text={brief.why} />

            <div style={s.section}>
              <span style={s.sectionLabel}>{t("block.risks")}</span>
              {brief.risks.length === 0 ? (
                <span style={s.emptyText}>{t("noRisks")}</span>
              ) : (
                <div style={s.rows}>
                  {brief.risks.map((risk, i) => (
                    <RiskRow key={`${risk.kind}:${risk.title}:${i}`} risk={risk} />
                  ))}
                </div>
              )}
            </div>

            <div style={s.section}>
              <div style={s.sectionHeaderRow}>
                <span style={s.sectionLabelIcon}>
                  <Icon.ListChecks size={13} style={{ color: "var(--accent-text)" }} />
                  {t("reviewFocus.title")}
                </span>
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {brief.review_focus.length}
                </Badge>
              </div>
              {brief.review_focus.length === 0 ? (
                <span style={s.emptyText}>{t("reviewFocus.empty")}</span>
              ) : (
                <div style={s.rows}>
                  {brief.review_focus.map((item, i) => (
                    <ReviewFocusRow
                      key={`${item.file}:${item.line ?? "x"}:${i}`}
                      item={item}
                      onJumpToCode={onJumpToCode}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div style={s.field}>
      <span style={s.fieldLabel}>{label}</span>
      <p style={s.fieldText}>{text}</p>
    </div>
  );
}

/** One risk as a bordered, collapsible row — severity icon-square + bold
   title + muted mono file_refs (plain text, not a control) up top; the
   explanation reveals below on click, mirroring BlastCard/SymbolRow's own
   per-row `open` state. */
function RiskRow({ risk }: { risk: Risk }) {
  const [open, setOpen] = React.useState(false);
  const level = RISK_LEVEL[risk.severity];
  const LevelIcon = Icon[level.icon];
  return (
    <div style={s.riskRow}>
      <button
        type="button"
        style={s.riskRowHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span style={{ ...s.riskIconBadge, background: level.bg }}>
          <LevelIcon size={13} style={{ color: level.c }} />
        </span>
        <div style={s.riskMain}>
          <span style={s.riskTitle}>{risk.title}</span>
          {risk.file_refs.length > 0 && (
            <span className="mono" style={s.riskFileRefs}>
              {risk.file_refs.join(", ")}
            </span>
          )}
        </div>
        <Icon.ChevronRight size={13} style={chevronStyle(open)} />
      </button>
      {open && <p style={s.riskExplanation}>{risk.explanation}</p>}
    </div>
  );
}

/** One review-focus item: a MonoLink (onClick-only, no href — this jumps
   in-app/opens on GitHub via the shared onJumpToCode callback, it never
   navigates via a rendered anchor) showing "file:line" (or just "file" when
   line is absent), plus its reason. Defaults to line 1 when the model
   didn't supply one — this default lives on the client, not the server. */
function ReviewFocusRow({
  item,
  onJumpToCode,
}: {
  item: ReviewFocusItem;
  onJumpToCode: (path: string, line: number) => void;
}) {
  return (
    <div style={s.focusRow}>
      <MonoLink accent onClick={() => onJumpToCode(item.file, item.line ?? 1)}>
        {item.line != null ? `${item.file}:${item.line}` : item.file}
      </MonoLink>
      <span style={s.focusReason}>— {item.reason}</span>
    </div>
  );
}
