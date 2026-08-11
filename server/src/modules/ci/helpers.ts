import { CiRunStatus, type CiInstallation, type CiRun, type RepoRef } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { CiInstallationRow, CiRunRow } from './repository.js';
import type { PostAs } from './types.js';

/**
 * DOMAIN CORE — pure DTO mapping only. No I/O, no `container`, no Drizzle.
 */

/** `"owner/name"` → a `RepoRef`. Rejects anything that is not exactly that. */
export function parseRepoRef(fullName: string): RepoRef {
  const parts = fullName.split('/');
  const ok =
    parts.length === 2 &&
    parts.every((p) => p.length > 0 && /^[A-Za-z0-9._-]+$/.test(p));
  if (!ok) {
    throw new ValidationError(
      `"${fullName}" is not a valid repository. Expected "owner/name".`,
    );
  }
  return { owner: parts[0]!, name: parts[1]! };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Narrow the persisted status text to the four states the UI renders (AC-49). */
export function toRunStatus(status: string | null | undefined): CiRunStatus | null {
  const parsed = CiRunStatus.safeParse(status);
  return parsed.success ? parsed.data : null;
}

export interface InstallationDtoInput {
  row: CiInstallationRow;
  /** Status of the most recent ingested run; null ⇒ pending (AC-58). */
  lastStatus: string | null;
  lastActivityAt: Date | null;
  /** The agent's CURRENT gate policy — compared for drift (AC-60). */
  agentCiFailOn: string | null;
}

export function toInstallationDto({
  row,
  lastStatus,
  lastActivityAt,
  agentCiFailOn,
}: InstallationDtoInput): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    workspace_id: row.workspaceId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    post_as: row.postAs,
    triggers: row.triggers ?? [],
    base: row.baseBranch,
    manifest_path: row.manifestPath,
    workflow_path: row.workflowPath,
    workflow_version: row.workflowVersion,
    pr_url: row.prUrl,
    last_ingest_at: iso(row.lastIngestAt),
    exported_ci_fail_on: row.exportedCiFailOn,
    // Derived, never stored: no run yet ⇒ null ⇒ the tab renders "pending".
    status: toRunStatus(lastStatus),
    last_activity_at: iso(lastActivityAt) ?? iso(row.lastIngestAt),
    // AC-60 — the gate policy travels INSIDE the committed manifest, so a
    // studio-side change has no effect in CI until a new pull request lands.
    policy_drift:
      row.exportedCiFailOn != null &&
      agentCiFailOn != null &&
      row.exportedCiFailOn !== agentCiFailOn,
  };
}

/**
 * A projected installation for the PREVIEW response, before anything is
 * persisted. `id` is empty precisely because no row exists yet; the values are
 * what the next successful install WOULD write.
 */
export interface ProjectedInstallation {
  existing: CiInstallationRow | undefined;
  workspaceId: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  postAs: PostAs;
  triggers: string[];
  base: string;
  manifestPath: string;
  workflowPath: string;
  workflowVersion: number;
  agentCiFailOn: string;
}

export function projectInstallationDto(p: ProjectedInstallation): CiInstallation {
  return {
    id: p.existing?.id ?? '',
    agent_id: p.agentId,
    workspace_id: p.workspaceId,
    repo: p.repo,
    target_type: p.targetType,
    installed_at: p.existing?.installedAt.toISOString() ?? new Date(0).toISOString(),
    post_as: p.postAs,
    triggers: p.triggers,
    base: p.base,
    manifest_path: p.manifestPath,
    workflow_path: p.workflowPath,
    workflow_version: p.workflowVersion,
    pr_url: p.existing?.prUrl ?? null,
    last_ingest_at: iso(p.existing?.lastIngestAt ?? null),
    exported_ci_fail_on: p.existing?.exportedCiFailOn ?? null,
    status: null,
    last_activity_at: null,
    policy_drift:
      p.existing?.exportedCiFailOn != null &&
      p.existing.exportedCiFailOn !== p.agentCiFailOn,
  };
}

export function toCiRunDto(row: CiRunRow, agentLiveName: string | null): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    workspace_id: row.workspaceId,
    agent_run_id: row.agentRunId,
    github_run_id: row.githubRunId,
    repo: row.repo ?? '',
    pr_number: row.prNumber,
    pr_title: row.prTitle,
    ran_at: iso(row.ranAt),
    status: row.status,
    findings_count: row.findingsCount,
    critical: row.critical,
    warning: row.warning,
    suggestion: row.suggestion,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    // The SNAPSHOT wins: it is the honest historical value and survives the
    // agent being renamed or deleted. The live name is only a fallback.
    agent: row.agentName ?? agentLiveName,
    duration_s: row.durationMs == null ? null : row.durationMs / 1000,
  };
}

/**
 * Terminal status for an ingested run (AC-48/AC-49). A valid artifact means the
 * review genuinely produced a result — including when the deterministic gate
 * made the JOB exit non-zero, which is a blocking review, not a broken one.
 *
 * The workflow-run conclusion is part of the answer, not decoration: deriving
 * the status from the finding count ALONE reported a run whose gate fired — red
 * check, merge stopped — as a green `succeeded`, contradicting the very job the
 * row links to. Findings say what the review found; the conclusion says what CI
 * did about it, and the status needs both.
 */
export function statusFromRun(findingsCount: number, conclusion: string | null): CiRunStatus {
  if (findingsCount === 0) return 'no_findings';
  return conclusion === 'failure' ? 'blocked' : 'succeeded';
}
