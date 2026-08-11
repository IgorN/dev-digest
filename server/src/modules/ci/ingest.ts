import {
  CiResultArtifact,
  type CiIngestResult,
  type GitHubClient,
  type WorkflowRunMeta,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { readArtifactJson } from './archive.js';
import { ARTIFACT_MAX_BYTES, ARTIFACT_NAME, REFRESH_MAX_RUNS, WORKFLOW_FILE } from './constants.js';
import { parseRepoRef, statusFromRun } from './helpers.js';
import { CiRepository, type CiInstallationRow } from './repository.js';

/**
 * APPLICATION ring — the Refresh use case (AC-34 – AC-44).
 *
 * There is NO webhook and NO upload path (AC-35): the only ingest channel is a
 * pull the user explicitly triggers. Everything it reads — the workflow-run
 * metadata and `devdigest-result.json` — is produced inside someone else's CI
 * and is therefore UNTRUSTED DATA, never instructions: it is size-capped,
 * schema-validated before a single field is persisted, and never interpolated
 * into a prompt, a query, a URL or a command.
 */

interface Accumulator {
  examined: number;
  ingested: number;
  skipped: number;
  already_known: number;
  failures: { github_run_id: string; reason: string }[];
}

export class CiIngestService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * Pull results for every installation in the workspace.
   *
   * Whole-batch failures (and ONLY these two) abort before any data changes:
   *  - no GitHub token → the existing `ConfigError` naming `GITHUB_TOKEN` (AC-42);
   *  - a 403 from the Actions API → the distinct Actions-read error (AC-43).
   * Everything else is per-run resilient (AC-40, AC-41).
   */
  async refresh(workspaceId: string): Promise<CiIngestResult> {
    // Throws ConfigError('GITHUB_TOKEN is not configured') when unset — the
    // existing configuration-error contract, reused rather than reinvented.
    const github = await this.container.github();

    const acc: Accumulator = {
      examined: 0,
      ingested: 0,
      skipped: 0,
      already_known: 0,
      failures: [],
    };

    const installations = await this.repo.listInstallationsWithAgent(workspaceId);
    for (const { installation, agent } of installations) {
      await this.refreshOne(workspaceId, github, installation, agent?.name ?? null, agent, acc);
    }
    return acc;
  }

  private async refreshOne(
    workspaceId: string,
    github: GitHubClient,
    installation: CiInstallationRow,
    agentName: string | null,
    agent: { provider: string | null; model: string | null } | null,
    acc: Accumulator,
  ): Promise<void> {
    const repoRef = parseRepoRef(installation.repo);

    // AC-34 + AC-44: newest first, bounded by the named constant. A 403 here is
    // NOT caught — an insufficient-scope token must fail the whole Refresh with
    // its own actionable message rather than silently ingesting nothing.
    const runs = await github.listWorkflowRuns(repoRef, WORKFLOW_FILE, REFRESH_MAX_RUNS);
    const stored = await this.repo.storedRunStatuses(installation.id);

    for (const run of runs) {
      acc.examined += 1;

      const priorStatus = stored.get(run.id);
      // AC-5 — a terminal row is never re-ingested, which is what makes three
      // consecutive Refreshes produce exactly one row per workflow run. A row
      // stored as `running` IS re-examined so it can be completed.
      if (priorStatus !== undefined && priorStatus !== 'running') {
        acc.already_known += 1;
        continue;
      }

      // A fork PR is skipped by the workflow's own condition, so there is
      // nothing to ingest: zero rows, zero downloads, counted as skipped. This
      // is idempotent by construction — the same bounded window re-derives the
      // same answer on every Refresh at zero extra API cost.
      if (run.conclusion === 'skipped') {
        acc.skipped += 1;
        continue;
      }

      // AC-49 — still in flight: record it as `running` and re-check next time.
      if (run.status !== 'completed') {
        await this.writeRunRow(workspaceId, installation, run, agentName, {
          status: 'running',
          agentRunId: null,
          artifact: null,
        });
        acc.ingested += 1;
        continue;
      }

      try {
        await this.ingestCompletedRun(
          workspaceId,
          github,
          installation,
          agentName,
          agent,
          run,
          repoRef,
          acc,
        );
      } catch (err) {
        // AC-40/AC-41 — one unreadable artifact fails ONLY that run.
        acc.failures.push({ github_run_id: run.id, reason: reasonOf(err) });
      }
    }

    await this.repo.touchLastIngest(installation.id, new Date());
  }

  private async ingestCompletedRun(
    workspaceId: string,
    github: GitHubClient,
    installation: CiInstallationRow,
    agentName: string | null,
    agent: { provider: string | null; model: string | null } | null,
    run: WorkflowRunMeta,
    repoRef: ReturnType<typeof parseRepoRef>,
    acc: Accumulator,
  ): Promise<void> {
    const artifacts = await github.listRunArtifacts(repoRef, run.id);
    const artifact = artifacts.find((a) => a.name === ARTIFACT_NAME && !a.expired);

    // AC-40 — no artifact (the review step hard-failed, or was cancelled): the
    // run is recorded from the workflow run's OWN conclusion and the batch
    // continues. The row exists so the CI Runs table stays honest.
    if (!artifact) {
      await this.writeRunRow(workspaceId, installation, run, agentName, {
        status: 'failed',
        agentRunId: null,
        artifact: null,
      });
      acc.failures.push({
        github_run_id: run.id,
        reason: `No ${ARTIFACT_NAME} artifact (workflow conclusion: ${run.conclusion ?? 'unknown'}).`,
      });
      return;
    }

    // The listing already tells us how big the artifact is, so refuse an
    // oversized one WITHOUT downloading it. Checking only after the download
    // still buffers the whole thing in memory first, which turns a hostile
    // (or merely broken) job's 500 MB upload into a memory/bandwidth lever
    // against this server on every Refresh. Same cap, enforced a step earlier.
    if (artifact.size_in_bytes > ARTIFACT_MAX_BYTES) {
      await this.writeRunRow(workspaceId, installation, run, agentName, {
        status: 'failed',
        agentRunId: null,
        artifact: null,
      });
      acc.failures.push({
        github_run_id: run.id,
        reason:
          `${ARTIFACT_NAME} is ${artifact.size_in_bytes} bytes, over the ` +
          `${ARTIFACT_MAX_BYTES}-byte limit — not downloaded.`,
      });
      return;
    }

    let parsedJson: unknown;
    try {
      const bytes = await github.downloadArtifact(repoRef, artifact.id, ARTIFACT_MAX_BYTES);
      parsedJson = readArtifactJson(bytes, ARTIFACT_MAX_BYTES);
    } catch (err) {
      // AC-41 — present but oversized / truncated / not extractable: a `failed`
      // row with a readable reason; the rest of the batch is unaffected.
      await this.writeRunRow(workspaceId, installation, run, agentName, {
        status: 'failed',
        agentRunId: null,
        artifact: null,
      });
      acc.failures.push({ github_run_id: run.id, reason: reasonOf(err) });
      return;
    }

    // AC-39 — validated against the SHARED `CiResultArtifact` schema BEFORE a
    // single field is persisted. A schema-invalid artifact writes NO row at all:
    // there is nothing trustworthy in it to render, and inventing a row from a
    // payload we just rejected would be worse than reporting the failure.
    const result = CiResultArtifact.safeParse(parsedJson);
    if (!result.success) {
      acc.failures.push({
        github_run_id: run.id,
        reason: `Result artifact failed validation: ${result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
          .join('; ')}`,
      });
      return;
    }
    const data = result.data;

    // AC-38 — link to the pull request only when the workspace already knows
    // it; otherwise leave the link empty and still persist the run.
    // Precedence: the artifact's own number, then the run payload's (frequently
    // absent on a `pull_request`-triggered run), then null.
    const prNumber = data.pr_number ?? run.pull_number ?? null;
    const pr =
      prNumber == null
        ? undefined
        : await this.repo.findPullRequest(workspaceId, installation.repo, prNumber);

    // AC-36/AC-37 — into the EXISTING run model, not a parallel CI one.
    const agentRunId = await this.repo.insertCiAgentRun({
      workspaceId,
      agentId: installation.agentId,
      prId: pr?.id ?? null,
      ranAt: runStartedAt(run),
      provider: agent?.provider ?? null,
      model: agent?.model ?? null,
      durationMs: data.duration_ms ?? null,
      status: 'completed',
      findingsCount: data.findings_count,
      costUsd: data.cost_usd,
    });

    await this.writeRunRow(workspaceId, installation, run, data.agent ?? agentName, {
      status: statusFromRun(data.findings_count, run.conclusion),
      agentRunId,
      artifact: data,
      prNumber,
    });
    acc.ingested += 1;
  }

  private async writeRunRow(
    workspaceId: string,
    installation: CiInstallationRow,
    run: WorkflowRunMeta,
    agentName: string | null,
    outcome: {
      status: string;
      agentRunId: string | null;
      artifact: CiResultArtifact | null;
      prNumber?: number | null;
    },
  ): Promise<void> {
    const a = outcome.artifact;
    await this.repo.upsertCiRun({
      workspaceId,
      ciInstallationId: installation.id,
      agentRunId: outcome.agentRunId,
      githubRunId: run.id,
      repo: installation.repo,
      agentName,
      // Snapshots taken from an untrusted payload: stored as-is and rendered as
      // escaped text; never interpolated anywhere.
      prTitle: run.display_title,
      prNumber: outcome.prNumber ?? run.pull_number ?? null,
      ranAt: runStartedAt(run),
      status: outcome.status,
      durationMs: a?.duration_ms ?? null,
      findingsCount: a?.findings_count ?? null,
      critical: a?.critical ?? null,
      warning: a?.warning ?? null,
      suggestion: a?.suggestion ?? null,
      costUsd: a?.cost_usd ?? null,
      githubUrl: run.html_url,
    });
  }
}

function runStartedAt(run: WorkflowRunMeta): Date {
  const raw = run.run_started_at ?? run.created_at;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function reasonOf(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? 'Unknown ingest failure.';
}
