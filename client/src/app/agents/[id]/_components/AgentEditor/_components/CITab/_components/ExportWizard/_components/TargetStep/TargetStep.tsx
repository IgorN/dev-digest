/* TargetStep — the wizard's first step (design-src/screen_export.jsx:54-62).

   Four target cards render exactly as the design shows them, but only GitHub
   Actions is selectable: CircleCI, Jenkins and Generic CLI are de-emphasised,
   carry a `coming soon` marker in the `recommended` badge slot, and are BOTH
   `disabled` and `aria-disabled` with an accessible explanation (AC-64, AC-65).

   The target repository is a CONSTRAINED picker over the workspace's own
   repositories, not the free-text field the scaffolded copy implies — free text
   would let a caller aim the server's GitHub token at any repo it can write to
   (AC-66, deliberate deviation #5). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, SelectInput } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { CI_TARGETS } from "../../constants";
import { s } from "../../styles";
import type { CiTarget } from "../../types";

export function TargetStep({
  target,
  onTarget,
  repo,
  onRepo,
  repos,
  providerBlocked,
  provider,
  blockMessage,
  hint,
  allowEmpty = true,
}: {
  target: CiTarget;
  onTarget: (t: CiTarget) => void;
  repo: string;
  onRepo: (r: string) => void;
  repos: Repo[];
  providerBlocked: boolean;
  provider: string;
  /** Server-side block (e.g. the repository is already claimed by another
      agent, AC-68) — the message names the installed agent, so it can only
      come from the server. */
  blockMessage?: string | null;
  /** Overrides the field hint — update mode explains that switching the repo
      switches WHICH installation is being edited. */
  hint?: string;
  /** False in update mode: there is no valid "no repository" state there. */
  allowEmpty?: boolean;
}) {
  const t = useTranslations("ci");
  /* The empty "choose one" entry exists only while a repository still has to be
     picked. Update mode always opens ON an installation, so offering a blank
     option there would let the user select "nothing" and silently invalidate the
     step. Its label is a real placeholder, not the design's `acme/payments-api`
     sample, which read as an already-selected repository. */
  const repoOptions = React.useMemo(
    () => [
      ...(allowEmpty ? [{ value: "", label: t("exportWizard.repoPlaceholder") }] : []),
      ...repos.map((r) => ({ value: r.full_name, label: r.full_name })),
    ],
    [repos, t, allowEmpty],
  );

  return (
    <div>
      <div style={s.targetGrid}>
        {CI_TARGETS.map((c) => {
          const I = Icon[c.icon];
          const selected = target === c.key;
          const descId = `ci-target-${c.key}-desc`;
          return (
            <button
              key={c.key}
              type="button"
              disabled={!c.available}
              aria-disabled={!c.available}
              aria-pressed={selected}
              aria-describedby={c.available ? undefined : descId}
              onClick={() => c.available && onTarget(c.key)}
              style={s.targetCard(selected, c.available)}
            >
              <div style={s.targetHead}>
                <div style={s.targetIcon(selected, c.available)}>
                  <I size={18} />
                </div>
                <span style={s.targetName(c.available)}>{t(`exportWizard.targets.${c.key}`)}</span>
                {c.recommended && (
                  <Badge
                    color="var(--accent-text)"
                    bg="var(--accent-bg)"
                    style={{ marginLeft: "auto" }}
                  >
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
                {!c.available && (
                  <Badge color="var(--text-muted)" style={{ marginLeft: "auto" }}>
                    {t("exportWizard.targets.comingSoon")}
                  </Badge>
                )}
              </div>
              <p style={s.targetDesc}>{t(`exportWizard.targets.${c.key}Desc`)}</p>
              {!c.available && (
                <span id={descId} style={s.srOnly}>
                  {t("exportWizard.targets.unavailable", {
                    target: t(`exportWizard.targets.${c.key}`),
                  })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={s.repoField}>
        <FormField
          label={t("exportWizard.repoLabel")}
          hint={hint ?? t("exportWizard.repoHint")}
          required
        >
          <SelectInput value={repo} onChange={onRepo} options={repoOptions} />
        </FormField>
      </div>

      {providerBlocked && (
        <div style={s.blockNotice} role="alert">
          <Icon.AlertTriangle size={15} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("exportWizard.providerBlocked", { provider })}</span>
        </div>
      )}
      {!providerBlocked && blockMessage && (
        <div style={s.blockNotice} role="alert">
          <Icon.AlertTriangle size={15} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 1 }} />
          <span>{blockMessage}</span>
        </div>
      )}
    </div>
  );
}
