/* InstallStep — the wizard's last step (design-src/screen_export.jsx:89-101).

   The primary card opens the pull request (AC-77); the secondary card is the
   degraded manual path — the SAME generated file set as a zip, with zero GitHub
   contact (AC-78). The footer carries the design's setup-docs link; the secret
   requirement itself belongs on Configure, next to the rest of the run
   settings, and the bundle size on Preview, next to the runner files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { ACTIONS_SECRETS_DOCS_URL } from "../../constants";
import { s } from "../../styles";

export function InstallStep({
  repo,
  fileCount,
  prUrl,
  isInstalling,
  installError,
  onInstall,
  onZip,
  isZipping,
}: {
  repo: string;
  fileCount: number;
  prUrl: string | null;
  isInstalling: boolean;
  installError: string | null;
  onInstall: () => void;
  onZip: () => void;
  isZipping: boolean;
}) {
  const t = useTranslations("ci");

  return (
    <div style={s.step}>
      {prUrl && (
        <div style={s.successCard} role="status">
          <Icon.CheckCircle size={16} style={{ color: "var(--ok)", flexShrink: 0 }} />
          <span>{t("exportWizard.installedTitle")}</span>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: "auto", color: "var(--accent-text)", fontWeight: 600 }}
          >
            {t("exportWizard.openPr")}
          </a>
        </div>
      )}

      {installError && (
        <div style={s.errorCard} role="alert">
          <Icon.AlertTriangle size={15} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 1 }} />
          <span>
            {t("exportWizard.installError")} {installError}
          </span>
        </div>
      )}

      {/* Disabled once the PR exists: re-clicking would open a second pull
          request against the same repository. */}
      <button
        type="button"
        onClick={onInstall}
        disabled={isInstalling || prUrl !== null}
        style={s.installCard}
      >
        <div style={s.installHead}>
          <Icon.GitPullRequest size={18} style={{ color: "var(--accent)" }} />
          <span style={s.installTitle}>{t("exportWizard.installCardTitle")}</span>
          <Badge color="var(--accent-text)" bg="var(--bg-elevated)" style={{ marginLeft: "auto" }}>
            {t("exportWizard.recommended")}
          </Badge>
        </div>
        <p style={s.installBody}>
          {isInstalling
            ? t("exportWizard.installing")
            : t("exportWizard.installCardBody", { repo, count: fileCount })}
        </p>
      </button>

      <button type="button" onClick={onZip} disabled={isZipping} style={s.zipCard}>
        <div style={s.zipRow}>
          <Icon.Copy size={16} style={{ color: "var(--text-secondary)" }} />
          <span style={s.zipTitle}>{t("exportWizard.zipCardTitle")}</span>
          <span style={s.zipHint}>{t("exportWizard.zipCardHint")}</span>
        </div>
      </button>

      <div style={s.note}>
        <p style={{ margin: 0 }}>
          {t.rich("exportWizard.needHelp", {
            link: (chunks) => (
              <a
                href={ACTIONS_SECRETS_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={s.docsLink}
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
