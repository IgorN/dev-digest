import type { CiExportInputBody, CiFile, CiInstallation, Repo } from "@devdigest/shared";
import { MANDATORY_TRIGGERS } from "./constants";
import type { PostAs, WizardConfig } from "./types";

/**
 * Seed the wizard from an EXISTING installation, so "Update CI config" opens on
 * the settings that are actually live rather than on defaults. Every field here
 * is already persisted and already on the contract — nothing is re-derived.
 */
export function configFromInstallation(installation: CiInstallation): WizardConfig {
  return {
    target: installation.target_type,
    repo: installation.repo,
    // Defensive: the column is a free `string[]`, and a set that lost its
    // mandatory entries would generate a workflow with no trigger at all.
    triggers: Array.from(new Set([...MANDATORY_TRIGGERS, ...installation.triggers])),
    postAs: installation.post_as as PostAs,
    base: installation.base,
  };
}

/**
 * The ONE editable entry in a generated file set is the workflow (AC-70) — the
 * server marks it, so the client never pattern-matches on the path.
 */
export function findWorkflowFile(files: CiFile[]): CiFile | undefined {
  return files.find((f) => f.editable);
}

/** Runner-bundle entries arrive with a placeholder marker and empty contents —
    ~1.6 MB of ncc output never reaches the browser (AC-71). */
export function isPlaceholder(file: CiFile): boolean {
  return typeof file.placeholder === "string" && file.placeholder.length > 0;
}

/** `opened` and `synchronize` cannot be deselected, so the trigger set can never
    become empty (AC-74). Everything else toggles. */
export function toggleTrigger(triggers: string[], trigger: string): string[] {
  if ((MANDATORY_TRIGGERS as readonly string[]).includes(trigger)) return triggers;
  return triggers.includes(trigger)
    ? triggers.filter((t) => t !== trigger)
    : [...triggers, trigger];
}

/** Wizard state → the server's export body. `workflow` is only sent when the
    user actually hand-edited it; absent means "generate it" (AC-70). */
export function toExportInput(
  config: WizardConfig,
  workflow: string | null,
): Omit<CiExportInputBody, "action"> {
  return {
    repo: config.repo,
    target: config.target,
    post_as: config.postAs,
    triggers: config.triggers,
    base: config.base,
    ...(workflow != null ? { workflow } : {}),
  };
}

/** Resolve a repository's default branch — the base the `devdigest/ci` branch
    forks from. Falls back to `main` when the repo is not loaded yet. */
export function baseBranchFor(repos: Repo[] | undefined, fullName: string): string {
  return repos?.find((r) => r.full_name === fullName)?.default_branch || "main";
}
