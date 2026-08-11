/* ConfigureStep — triggers, `Post results as`, and the block-merge info card
   (design-src/screen_export.jsx:74-87).

   `opened` and `synchronize` are mandatory, so the trigger set can never become
   empty (AC-74); only `reopened` toggles. The info card renders
   `ci.exportWizard.blockMergeInfo` — NOT the pre-existing `blockMergeDesc`,
   which claims the opposite ("Requires a GitHub App") and stays untouched
   per AC-82. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Chip, FormField, Icon } from "@devdigest/ui";
import {
  ALL_TRIGGERS,
  GITHUB_TOKEN_SECRET_NAME,
  MANDATORY_TRIGGERS,
  POST_AS_OPTIONS,
  RUNNER_SECRET_NAME,
} from "../../constants";
import { s } from "../../styles";
import type { PostAs } from "../../types";

export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAs,
  workflowRegenerated,
}: {
  triggers: string[];
  onToggleTrigger: (trigger: string) => void;
  postAs: PostAs;
  onPostAs: (value: PostAs) => void;
  /** True once a Configure change replaced a hand-edited workflow (AC-72). */
  workflowRegenerated: boolean;
}) {
  const t = useTranslations("ci");

  return (
    <div style={s.step}>
      {workflowRegenerated && (
        <div style={s.regenNotice} role="status">
          <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("exportWizard.workflowRegenerated")}</span>
        </div>
      )}

      <FormField label={t("exportWizard.triggerLabel")}>
        <div style={s.chipRow}>
          {ALL_TRIGGERS.map((trigger) => {
            const active = triggers.includes(trigger);
            const mandatory = (MANDATORY_TRIGGERS as readonly string[]).includes(trigger);
            return (
              <Chip
                key={trigger}
                active={active}
                icon={active ? "Check" : undefined}
                onClick={() => onToggleTrigger(trigger)}
              >
                {t(`exportWizard.triggers.${trigger}`)}
                {mandatory ? ` · ${t("exportWizard.triggers.required")}` : ""}
              </Chip>
            );
          })}
        </div>
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")} hint={t("exportWizard.postAsHint")}>
        <div style={s.radioList} role="radiogroup" aria-label={t("exportWizard.postResultsLabel")}>
          {POST_AS_OPTIONS.map((o) => {
            const selected = postAs === o.value;
            return (
              <label key={o.value} style={s.radioLabel}>
                <input
                  type="radio"
                  name="ci-post-as"
                  value={o.value}
                  checked={selected}
                  onChange={() => onPostAs(o.value)}
                  style={s.srOnly}
                />
                <span style={s.radioDot(selected)} aria-hidden>
                  {selected && <span style={s.radioInner} />}
                </span>
                {t(`exportWizard.${o.labelKey}`)}
                {o.recommended && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </FormField>

      {/* The two secrets the generated workflow reads, stated next to the run
          settings they belong to rather than on the Install step. `GITHUB_TOKEN`
          is genuinely known-good — Actions injects it on every run — so it is
          the only one carrying a "ready" state. The OpenRouter key is a
          REQUIREMENT, not a status: DevDigest cannot see the target repo's
          secrets, so claiming "not set" would be a guess. */}
      <FormField label={t("exportWizard.secretsLabel")}>
        <div style={s.secretList}>
          <div style={s.secretRow}>
            <span className="mono" style={s.secretName}>
              {RUNNER_SECRET_NAME}
            </span>
            <span style={s.secretDesc}>{t("exportWizard.secrets.openrouter")}</span>
            <Badge color="var(--warn)" bg="var(--warn-bg)" dot>
              {t("exportWizard.secretRequired")}
            </Badge>
          </div>
          <div style={s.secretRow}>
            <span className="mono" style={s.secretName}>
              {GITHUB_TOKEN_SECRET_NAME}
            </span>
            <span style={s.secretDesc}>{t("exportWizard.secrets.githubToken")}</span>
            <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
              {t("exportWizard.secretReady")}
            </Badge>
          </div>
        </div>
      </FormField>

      <div style={s.infoCard}>
        <Icon.Info size={15} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
        <div style={s.infoText}>{t("exportWizard.blockMergeInfo")}</div>
      </div>
    </div>
  );
}
