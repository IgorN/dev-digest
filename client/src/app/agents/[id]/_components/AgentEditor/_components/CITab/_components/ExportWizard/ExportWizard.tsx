/* ExportWizard — the 4-step Export to CI modal
   (design-src/screen_export.jsx:46-112).

   State for all four steps lives HERE, in one `WizardConfig` object plus the
   user's optional workflow edit, so that a Configure change can regenerate from
   an explicit next-config rather than from possibly-stale state. Nothing is
   hard-coded from the design: the preview renders the server's generated file
   set, and the workflow it shows is the server's (deliberately stricter)
   generated YAML — never the design's fabricated `YAML_PREVIEW`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiInstallation } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import {
  useDownloadCiZip,
  useGenerateCiExport,
  useInstallCiExport,
} from "@/lib/hooks/ci-export";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { MANDATORY_TRIGGERS, RUNNER_PROVIDER, STEP_KEYS } from "./constants";
import {
  baseBranchFor,
  configFromInstallation,
  findWorkflowFile,
  toExportInput,
  toggleTrigger,
} from "./helpers";
import { s } from "./styles";
import type { CiTarget, PostAs, WizardConfig } from "./types";

const LAST_STEP = STEP_KEYS.length - 1;
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

function errorMessage(e: unknown): string | null {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return null;
}

export function ExportWizard({
  agent,
  onClose,
  installations = [],
  mode = "create",
}: {
  agent: Agent;
  onClose: () => void;
  /** Existing installations for this agent — the update mode's source of truth. */
  installations?: CiInstallation[];
  mode?: "create" | "update";
}) {
  const t = useTranslations("ci");
  const { data: repos } = useRepos();
  const generate = useGenerateCiExport();
  const install = useInstallCiExport();
  const zip = useDownloadCiZip();

  const isUpdate = mode === "update" && installations.length > 0;

  const [step, setStep] = React.useState(0);
  const [config, setConfig] = React.useState<WizardConfig>(() =>
    // Update mode opens on the settings that are actually live. Seeding in the
    // lazy initializer (not an effect) means the first render is already correct
    // — an effect would flash the defaults and, worse, race the user's edits.
    isUpdate
      ? configFromInstallation(installations[0]!)
      : {
          target: "gha",
          repo: "",
          triggers: [...MANDATORY_TRIGGERS],
          postAs: "github_review",
          base: "main",
        },
  );
  const [workflowEdit, setWorkflowEdit] = React.useState<string | null>(null);
  const [workflowRegenerated, setWorkflowRegenerated] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const files = generate.data?.files ?? [];
  const workflowFile = findWorkflowFile(files);
  const workflowValue = workflowEdit ?? workflowFile?.contents ?? "";
  const providerBlocked = agent.provider !== RUNNER_PROVIDER;
  const canLeaveTarget = !providerBlocked && config.repo !== "";
  const prUrl = install.data?.pr_url ?? null;

  /* Escape closes and Tab cycles inside the dialog — the vendored `Modal`
     primitive provides neither and is not ours to change (NFR accessibility). */
  React.useEffect(() => {
    const dialog = anchorRef.current?.closest('[role="dialog"]') as HTMLElement | null;
    if (!dialog) return;
    dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = active != null && dialog.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Ask the server for a fresh file set. Never sends a stale workflow edit —
      `workflow` is only passed when the caller explicitly keeps it (AC-70). */
  const runGenerate = async (next: WizardConfig, workflow: string | null) => {
    const result = await generate
      .mutateAsync({ agentId: agent.id, input: toExportInput(next, workflow) })
      .catch(() => null);
    if (result) {
      setSelectedPath(findWorkflowFile(result.files)?.path ?? result.files[0]?.path ?? null);
    }
    return result;
  };

  /** A Configure-step change always regenerates the workflow. IF the user had
      hand-edited it, the edit is dropped AND an explicit notice says so — never
      silently discarded, never silently retained (AC-72). */
  const applyConfig = (patch: Partial<WizardConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (workflowEdit !== null) {
      setWorkflowEdit(null);
      setWorkflowRegenerated(true);
    }
    void runGenerate(next, null);
  };

  /* In update mode the repo picker doubles as "which installation am I editing":
     switching it re-seeds triggers/post_as/base from THAT installation, so the
     one header button works identically with one repo or five. */
  const selectRepo = (repo: string) => {
    generate.reset();
    const existing = isUpdate ? installations.find((i) => i.repo === repo) : undefined;
    setConfig((c) =>
      existing ? configFromInstallation(existing) : { ...c, repo, base: baseBranchFor(repos, repo) },
    );
  };

  const handleContinue = async () => {
    if (step === 0) {
      if (!canLeaveTarget) return;
      const result = await runGenerate(config, null);
      if (result) setStep(1);
      return;
    }
    setStep((sIdx) => Math.min(sIdx + 1, LAST_STEP));
  };

  /** Clicking a mandatory chip is a genuine no-op — no regeneration, and above
      all no "your edit was replaced" notice for a change that never happened. */
  const handleToggleTrigger = (trigger: string) => {
    const next = toggleTrigger(config.triggers, trigger);
    if (next === config.triggers) return;
    applyConfig({ triggers: next });
  };

  /* Guarded on `prUrl`: without it the primary button stays live after a
     successful install and a second click opens a SECOND pull request against
     the same repo. */
  const handleInstall = () => {
    if (prUrl) return;
    install.mutate({ agentId: agent.id, input: toExportInput(config, workflowEdit) });
  };

  const stepLabels = STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`));

  /* Update mode restricts the picker to repos this agent is ALREADY installed
     in — anything else would silently turn an update into a new installation. */
  const repoChoices = React.useMemo(() => {
    const all = repos ?? [];
    if (!isUpdate) return all;
    const installed = new Set(installations.map((i) => i.repo));
    return all.filter((r) => installed.has(r.full_name));
  }, [repos, isUpdate, installations]);

  return (
    <Modal
      width={720}
      title={isUpdate ? t("exportWizard.updateTitle") : t("exportWizard.title")}
      subtitle={t(isUpdate ? "exportWizard.updateSubtitle" : "exportWizard.subtitle", {
        agentName: agent.name || t("exportWizard.thisAgent"),
      })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {step > 0 && (
            <Button kind="ghost" icon="ChevronLeft" onClick={() => setStep((i) => i - 1)}>
              {t("exportWizard.back")}
            </Button>
          )}
          <div style={s.footerRight}>
            {step < LAST_STEP ? (
              <Button
                kind="primary"
                iconRight="ArrowRight"
                disabled={step === 0 && !canLeaveTarget}
                loading={step === 0 && generate.isPending}
                onClick={handleContinue}
              >
                {t("exportWizard.continue")}
              </Button>
            ) : prUrl ? (
              /* Deliberately NOT auto-closing on success: the PR link and the
                 secret reminder are the whole payoff of this step, and closing
                 out from under the user throws both away. The button becomes
                 the explicit exit instead — and stops being a second Install. */
              <Button kind="primary" icon="Check" onClick={onClose}>
                {t("exportWizard.done")}
              </Button>
            ) : (
              <Button kind="primary" icon="Check" loading={install.isPending} onClick={handleInstall}>
                {install.isPending
                  ? t(isUpdate ? "exportWizard.updating" : "exportWizard.installing")
                  : t(isUpdate ? "exportWizard.update" : "exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div ref={anchorRef} style={s.stepsBar}>
        <ExportWizardSteps step={step} labels={stepLabels} />
        <p aria-live="polite" style={s.srOnly}>
          {`${stepLabels[step]} — ${step + 1} / ${STEP_KEYS.length}`}
        </p>
      </div>

      <div style={s.body}>
        {step === 0 && (
          <TargetStep
            target={config.target}
            onTarget={(target: CiTarget) => setConfig((c) => ({ ...c, target }))}
            repo={config.repo}
            onRepo={selectRepo}
            repos={repoChoices}
            providerBlocked={providerBlocked}
            provider={agent.provider}
            blockMessage={errorMessage(generate.error)}
            hint={isUpdate ? t("exportWizard.updateRepoHint") : undefined}
            allowEmpty={!isUpdate}
          />
        )}
        {step === 1 && (
          <PreviewStep
            files={files}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            workflowValue={workflowValue}
            onWorkflowChange={setWorkflowEdit}
            isGenerating={generate.isPending}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={config.triggers}
            onToggleTrigger={handleToggleTrigger}
            postAs={config.postAs}
            onPostAs={(postAs: PostAs) => applyConfig({ postAs })}
            workflowRegenerated={workflowRegenerated}
          />
        )}
        {step === LAST_STEP && (
          <InstallStep
            repo={generate.data?.repo ?? config.repo}
            fileCount={generate.data?.file_count ?? files.length}
            prUrl={prUrl}
            isInstalling={install.isPending}
            installError={errorMessage(install.error)}
            onInstall={handleInstall}
            onZip={() =>
              zip.mutate({ agentId: agent.id, input: toExportInput(config, workflowEdit) })
            }
            isZipping={zip.isPending}
          />
        )}
      </div>
    </Modal>
  );
}
