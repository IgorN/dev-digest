/* InstallationRow — one repository row on the agent's CI tab
   (design-src/screen_agents.jsx:150-156), extended with the workflow version
   (AC-57) and the gate-policy drift notice (AC-60). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { s } from "../../styles";
import { statusColors, statusMessageKey, timeAgo } from "../../helpers";

export function InstallationRow({ installation }: { installation: CiInstallation }) {
  const t = useTranslations("ci");
  const colors = statusColors(installation.status);
  // No ingested run yet ⇒ an EXPLICIT pending state, never success or failure.
  const statusLabel = installation.status
    ? t(statusMessageKey(installation.status))
    : t("ciTab.pending");

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <Icon.GitBranch size={16} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.rowRepo}>
          {installation.repo}
        </span>
        <Badge color="var(--text-secondary)" icon="Workflow">
          {t(`exportWizard.targets.${installation.target_type}`)}
        </Badge>
        <Badge color={colors.color} bg={colors.bg} dot>
          {statusLabel}
        </Badge>
        <span style={s.rowVersion}>
          {t("ciTab.workflowVersion", { version: installation.workflow_version })}
        </span>
        <span style={s.rowTime}>{timeAgo(installation.last_activity_at)}</span>
      </div>
      {installation.policy_drift && (
        <div style={s.drift}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>
            {t("ciTab.driftNotice", { exported: installation.exported_ci_fail_on ?? "—" })}
          </span>
        </div>
      )}
    </div>
  );
}
