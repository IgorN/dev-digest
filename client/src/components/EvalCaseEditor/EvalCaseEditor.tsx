/* EvalCaseEditor — shared modal for creating/editing an eval case (L06). Used
   from TWO places (FindingCard's "Turn into eval case" flow, and the Agent
   Editor's Evals tab "+ New"/edit actions) — per `frontend-architecture`'s
   "used in 2+ places -> shared location" rule, this lives outside any one
   route rather than colocated.

   "Run on save" is deliberately NOT wired through `useUpdateEvalCase`'s own
   `run_on_save` payload flag: that hook's PUT response is typed as a bare
   `EvalCase` (no run data), so relying on it for the fresh status-strip
   result isn't type-safe. Instead this component persists the case, then —
   if "Run on save" is on — makes exactly ONE separate call to
   `useRunEvalBatch(agentId)` scoped to this one case id, and reads the fresh
   metrics straight from that (correctly-typed) response. See client
   INSIGHTS.md for the fuller rationale if this surprises a future reader. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Modal,
  Tabs,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { useCreateEvalCase, useRunEvalBatch, useUpdateEvalCase } from "@/lib/hooks/eval";
import { formatCost } from "@/lib/cost";
import {
  appendFindingSkeleton,
  expectedCount,
  formatDurationMs,
  parseExpectedOutput,
  stripDataFromRecord,
  stripDataFromResult,
  type RunStripData,
} from "./helpers";
import { DEFAULT_RUN_ON_SAVE, FINDING_SKELETON, MODAL_WIDTH, type InputTabKey } from "./constants";
import { s } from "./styles";

export interface EvalCaseEditorProps {
  /** Agent this case belongs (or will belong) to — needed to run the case. */
  agentId: string;
  /** Display name for the modal subtitle ("<Agent name> · simulate a PR..."). */
  agentName?: string;
  /** The case being edited, or `null` to create a new one for this agent. */
  evalCase: EvalCase | null;
  /** The case's latest run, if the caller already has it (e.g. the Evals
     tab's case list, which tracks pass/fail per row). Omit/null when unknown
     or the case has never run — the status strip stays hidden until a run
     happens in THIS render (AC-10). */
  latestRun?: EvalRunRecord | null;
  onClose: () => void;
  /** Fired after a successful create/update with the freshly saved case. */
  onSaved?: (savedCase: EvalCase) => void;
}

export function EvalCaseEditor({
  agentId,
  agentName,
  evalCase,
  latestRun,
  onClose,
  onSaved,
}: EvalCaseEditorProps) {
  const t = useTranslations("eval");

  const createCase = useCreateEvalCase(agentId);
  const updateCase = useUpdateEvalCase(evalCase?.id ?? "");
  const runBatch = useRunEvalBatch(agentId);

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diffText, setDiffText] = React.useState(evalCase?.input_diff ?? "");
  const [expectedText, setExpectedText] = React.useState(
    JSON.stringify(evalCase?.expected_output ?? [], null, 2),
  );
  const [runOnSave, setRunOnSave] = React.useState(DEFAULT_RUN_ON_SAVE);
  const [activeTab, setActiveTab] = React.useState<InputTabKey>("diff");
  const [freshRun, setFreshRun] = React.useState<RunStripData | null>(null);
  const [savedCase, setSavedCase] = React.useState<EvalCase | null>(evalCase);

  const parsed = parseExpectedOutput(expectedText);
  const isSaving = createCase.isPending || updateCase.isPending;
  const isRunning = runBatch.isPending;
  const saveDisabled = !parsed.valid || name.trim() === "" || isSaving;

  // AC-9/AC-10: a fresh in-session run always wins; otherwise fall back to
  // the caller-supplied latest record; otherwise the strip is omitted
  // entirely — never a zeroed/failed placeholder.
  const strip: RunStripData | null =
    freshRun ?? (latestRun ? stripDataFromRecord(latestRun, savedCase) : null);

  async function persist(): Promise<EvalCase> {
    const fields = {
      name: name.trim(),
      input_diff: diffText,
      input_files: savedCase?.input_files ?? null,
      input_meta: savedCase?.input_meta ?? null,
      expected_output: parsed.value ?? [],
      notes: savedCase?.notes ?? null,
    };
    const result = savedCase ? await updateCase.mutateAsync(fields) : await createCase.mutateAsync(fields);
    setSavedCase(result);
    return result;
  }

  async function runOneCase(caseId: string, expected: number) {
    const response = await runBatch.mutateAsync({ case_ids: [caseId] });
    const result = response.results.find((r) => r.case_id === caseId);
    if (result) setFreshRun(stripDataFromResult(result, expected));
  }

  async function handleSave() {
    if (saveDisabled) return;
    const saved = await persist();
    onSaved?.(saved);
    if (runOnSave) await runOneCase(saved.id, expectedCount(saved));
  }

  async function handleRunCase() {
    if (!savedCase) return;
    await runOneCase(savedCase.id, expectedCount(savedCase));
  }

  return (
    <Modal
      width={MODAL_WIDTH}
      title={savedCase ? t("caseEditor.caseTitle", { name: savedCase.name }) : t("caseEditor.newCase")}
      subtitle={agentName ? `${agentName} · simulate a PR and assert the expected output` : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {strip && (
            <div style={s.strip}>
              <span style={{ color: strip.pass ? "var(--ok)" : "var(--crit)", fontWeight: 600 }}>
                {strip.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
              </span>
              <span style={s.stripDetail}>
                {t("caseEditor.resultDetail", {
                  expected: strip.expected,
                  got: strip.got,
                  duration: formatDurationMs(strip.durationMs),
                  cost: formatCost(strip.costUsd),
                })}
              </span>
              {!strip.pass && (
                <span style={s.stripDetail}>
                  {t("caseEditor.failureBreakdown", {
                    missed: strip.breakdown.missed,
                    falsePositives: strip.breakdown.falsePositives,
                    extra: strip.breakdown.extra,
                  })}
                </span>
              )}
            </div>
          )}
          <div style={s.actions}>
            <Button kind="ghost" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button
              kind="secondary"
              icon="Play"
              onClick={handleRunCase}
              loading={isRunning}
              disabled={!savedCase || isRunning}
            >
              {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button kind="primary" onClick={handleSave} loading={isSaving} disabled={saveDisabled}>
              {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>

        <FormField label={t("caseEditor.inputLabel")}>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "files", label: t("caseEditor.tabs.files") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={activeTab}
            onChange={(k) => setActiveTab(k as InputTabKey)}
            pad="0"
          />
          <div style={s.tabPanel}>
            {activeTab === "diff" && (
              <Textarea
                value={diffText}
                onChange={setDiffText}
                rows={10}
                mono
                placeholder={t("caseEditor.diffPlaceholder")}
              />
            )}
            {activeTab === "files" && (
              <pre style={s.readonlyPre}>{JSON.stringify(savedCase?.input_files ?? null, null, 2)}</pre>
            )}
            {activeTab === "prMeta" && (
              <pre style={s.readonlyPre}>{JSON.stringify(savedCase?.input_meta ?? null, null, 2)}</pre>
            )}
          </div>
        </FormField>

        <FormField
          label={t("caseEditor.expectedOutput")}
          right={
            <Badge
              icon={parsed.valid ? "CheckCircle" : "XCircle"}
              color={parsed.valid ? "var(--ok)" : "var(--crit)"}
              bg={parsed.valid ? "var(--ok-bg)" : "var(--crit-bg)"}
            >
              {parsed.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </Badge>
          }
        >
          <Textarea value={expectedText} onChange={setExpectedText} rows={10} mono />
          <div style={s.skeletonRow}>
            <Button
              kind="ghost"
              size="sm"
              icon="Plus"
              onClick={() => setExpectedText(appendFindingSkeleton(expectedText, FINDING_SKELETON))}
            >
              {t("caseEditor.addSkeleton")}
            </Button>
          </div>
        </FormField>

        <FormField label={t("caseEditor.runOnSave")}>
          <Toggle on={runOnSave} onChange={setRunOnSave} />
        </FormField>
      </div>
    </Modal>
  );
}
