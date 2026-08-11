/* CITab — the agent editor's CI tab (L08 Export to CI).
   Ported from `design-src/screen_agents.jsx:121-160`, extended per the spec with
   the workflow version, the explicit pending status and the gate-policy drift
   notice. Data comes from `useCiInstallations`; the `Fail CI on` control writes
   through the existing `useUpdateAgent` mutation. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci-export";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportWizard } from "./_components/ExportWizard";
import { InstallationRow } from "./_components/InstallationRow";
import { FAIL_ON_OPTIONS } from "./constants";
import { s } from "./styles";

export function CITab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { data: installations, isLoading } = useCiInstallations(agent.id);
  const update = useUpdateAgent();
  // `null` = closed. "update" seeds the wizard from an existing installation;
  // "create" starts blank. Both used to call one `openWizard`, which is why
  // "Update CI config" looked identical to a fresh export.
  const [wizardMode, setWizardMode] = React.useState<"create" | "update" | null>(null);
  // Optimistic gate-policy selection so the segmented control reflects the click
  // immediately; cleared once the agent row comes back from the server.
  const [pendingFailOn, setPendingFailOn] = React.useState<CiFailOn | null>(null);

  const rows = installations ?? [];
  const failOn = pendingFailOn ?? agent.ci_fail_on;

  const openWizard = () => setWizardMode("create");
  const openUpdate = () => setWizardMode("update");
  const selectFailOn = (value: CiFailOn) => {
    if (value === failOn) return;
    setPendingFailOn(value);
    update.mutate(
      { id: agent.id, patch: { ci_fail_on: value } },
      { onSettled: () => setPendingFailOn(null) },
    );
  };

  return (
    <>
      {/* Rendered as a SIBLING of the tab root: a fixed-position modal does not
          escape an ancestor's `opacity`/`filter` (client/INSIGHTS.md 2026-07-30). */}
      {wizardMode && (
        <ExportWizard
          // Remount on mode change: the wizard seeds its config in a lazy
          // initializer, so without a distinct key a create→update switch would
          // keep the stale first-mount state.
          key={wizardMode}
          agent={agent}
          mode={wizardMode}
          installations={rows}
          onClose={() => setWizardMode(null)}
        />
      )}
      <div style={s.wrap}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={24} width={220} />
            <Skeleton height={64} />
          </div>
        ) : rows.length === 0 ? (
          <div style={s.empty}>
            <EmptyState
              icon="Workflow"
              title={t("ciTab.emptyTitle")}
              body={t("ciTab.emptyBody")}
              cta={t("ciTab.addToCi")}
              onCta={openWizard}
            />
          </div>
        ) : (
          <>
            <div style={s.header}>
              <h2 style={s.h2}>{t("ciTab.deployment")}</h2>
              <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                {t("ciTab.activeIn", { count: rows.length })}
              </Badge>
              <div style={s.headerActions}>
                <Button kind="secondary" size="sm" icon="RefreshCw" onClick={openUpdate}>
                  {t("ciTab.updateConfig")}
                </Button>
                <Button kind="primary" size="sm" icon="Plus" onClick={openWizard}>
                  {t("ciTab.addToCi")}
                </Button>
              </div>
            </div>

            <div style={s.failCard}>
              <div style={s.failCopy}>
                <div style={s.failTitle}>{t("ciTab.failOnTitle")}</div>
                <div style={s.failDesc}>{t("ciTab.failOnDesc")}</div>
              </div>
              <div style={s.segmented} role="radiogroup" aria-label={t("ciTab.failOnTitle")}>
                {FAIL_ON_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={failOn === o.value}
                    onClick={() => selectFailOn(o.value)}
                    style={s.segment(failOn === o.value)}
                  >
                    {t(`ciTab.${o.labelKey}`)}
                  </button>
                ))}
              </div>
            </div>

            {rows.map((installation) => (
              <InstallationRow key={installation.id} installation={installation} />
            ))}

            <button type="button" onClick={openWizard} style={s.addRepo}>
              <Icon.Plus size={15} />
              {t("ciTab.addRepository")}
            </button>
          </>
        )}
      </div>
    </>
  );
}
