/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { EvalCase, FindingRecord, FindingActionKind } from "@devdigest/shared";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/eval";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  forceExpandNonce,
  reviewAgentId = null,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Bumping this (to any new value) force-expands this card and scrolls it
     into view — set by FindingsPanel only on the ONE card matching a Smart
     Diff badge click's target finding id; every other card gets `undefined`,
     which never changes, so its effect never fires. */
  forceExpandNonce?: number;
  /** The owning review's agent id (`null` when the review has no agent) —
     gates "Turn into eval case" (AC-4): with no agent there's no owner to
     attach a new eval case to. Threaded from ReviewRunAccordion's
     `review.agent_id` via FindingsPanel. */
  reviewAgentId?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const createEvalCase = useCreateEvalCaseFromFinding();
  // Doubles as "is the editor open" (non-null) and "which case it's editing" —
  // ephemeral, per-card UI state, same idiom as this card's own `expanded`.
  const [newEvalCase, setNewEvalCase] = React.useState<EvalCase | null>(null);
  React.useEffect(() => {
    if (forceExpandNonce == null) return;
    setExpanded(true);
    // `behavior: "smooth"` silently no-ops here: the scrollable ancestor is
    // AppShell's inner <main> (overflow-y: auto), not the window/documentElement,
    // and this nested-container + concurrent-React-render combination doesn't
    // reliably animate in this app (verified: "auto" always lands correctly,
    // "smooth" — even deferred a frame — stays put).
    rootRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [forceExpandNonce]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  // AC-3: still pending a disposition (neither accepted nor dismissed).
  const findingPending = !accepted && !dismissed;
  const turnIntoEvalDisabled =
    !!pending || createEvalCase.isPending || findingPending || reviewAgentId == null;

  function handleTurnIntoEvalCase() {
    if (turnIntoEvalDisabled) return;
    createEvalCase.mutate(f.id, { onSuccess: (created) => setNewEvalCase(created) });
  }

  return (
    <>
      <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
        <div onClick={() => setExpanded((e) => !e)} style={s.header}>
          <div style={s.badgeWrap}>
            <SeverityBadge severity={f.severity as Severity} compact />
          </div>
          <div style={s.headerMain}>
            <div style={s.titleRow}>
              <span style={s.title(muted, dismissed)}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
              {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
              {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
            </div>
            <div style={s.metaRow}>
              <MonoLink href={fileHref}>
                {f.file}:{lineLabel(f)}
              </MonoLink>
              <ConfidenceNum value={f.confidence} />
            </div>
          </div>
          <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
        </div>

        {expanded && (
          <div style={s.body}>
            <div style={s.prose}>
              <Markdown>{f.rationale}</Markdown>
            </div>
            {f.suggestion && (
              <div style={s.suggestionWrap}>
                <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
                <div style={s.prose}>
                  <Markdown>{f.suggestion}</Markdown>
                </div>
              </div>
            )}

            <div style={s.actions}>
              <Button
                kind="secondary"
                size="sm"
                icon="Check"
                disabled={pending}
                active={accepted}
                onClick={() => onAction?.("accept")}
              >
                {t("finding.accept")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                disabled={pending}
                active={dismissed}
                onClick={() => onAction?.("dismiss")}
              >
                {t("finding.dismiss")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={turnIntoEvalDisabled}
                loading={createEvalCase.isPending}
                onClick={handleTurnIntoEvalCase}
              >
                {t("finding.turnIntoEvalCase")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Rendered as a SIBLING of the card div above (not a descendant): the
         card's own root can be opacity-dimmed via `s.card`'s `muted` arg, and
         "Turn into eval case" is only ever clickable once `muted` is true
         (accepted/dismissed) — so nesting the modal inside that div meant it
         ALWAYS inherited the 0.6 opacity and rendered translucent. CSS
         opacity applies to a `position: fixed` descendant's compositing too,
         not just its layout, so `position: fixed` alone doesn't escape it. */}
      {newEvalCase && (
        <EvalCaseEditor
          agentId={reviewAgentId ?? ""}
          evalCase={newEvalCase}
          onClose={() => setNewEvalCase(null)}
        />
      )}
    </>
  );
}
