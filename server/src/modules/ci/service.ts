import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiRunsResponse,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { zipFiles } from './archive.js';
import {
  CI_BRANCH,
  COMMIT_MESSAGE,
  PR_TITLE,
  RUNNER_PROVIDER,
  WORKFLOW_PATH,
} from './constants.js';
import { buildFileSet, toPreviewFiles } from './generation.js';
import {
  parseRepoRef,
  projectInstallationDto,
  toCiRunDto,
  toInstallationDto,
} from './helpers.js';
import {
  CiRepository,
  type CiInstallationRow,
  type CiRunFilters,
} from './repository.js';
import { readRunnerBundle } from './runner-bundle.js';
import { manifestPathFor } from './slug.js';
import { normalizePostAs, normalizeTriggers } from './workflow.js';
import type { CiAgentInput, CiSkillInput } from './types.js';

/**
 * APPLICATION ring — export/install orchestration.
 *
 * Adapters come off `container` (never `new`-ed), typed errors come from
 * `platform/errors.ts`, and every generation decision is delegated to the pure
 * core so this file only sequences use-cases.
 */

interface Prepared {
  agent: CiAgentInput;
  agentId: string;
  agentCiFailOn: string;
  existing: CiInstallationRow | undefined;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  postAs: ReturnType<typeof normalizePostAs>;
  triggers: string[];
  base: string;
  manifestPath: string;
  /** The version the NEXT successful install will persist (AC-32). */
  nextWorkflowVersion: number;
  /** Full file set — real runner bytes. Never returned to the client as-is. */
  files: CiFile[];
}

export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  // ---- generation ---------------------------------------------------------

  /**
   * Everything both `generate` and `install` need, with every block applied
   * BEFORE a single byte reaches GitHub. Generation is all-or-nothing: a
   * blocked provider, a repository outside the workspace, a repository already
   * claimed by another agent, or a missing/partially-readable runner bundle
   * rejects the whole request and writes nothing (AC-15, AC-15a, AC-66 – AC-68).
   */
  private async prepare(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<Prepared> {
    const agentRow = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agentRow) throw new NotFoundError('Agent not found');

    // AC-67 — the runner unconditionally constructs an OpenRouter provider from
    // OPENROUTER_API_KEY. Failing loudly here beats failing confusingly inside
    // someone else's CI run, which costs them a job minute and produces nothing.
    if (agentRow.provider !== RUNNER_PROVIDER) {
      throw new ValidationError(
        `This agent runs on ${agentRow.provider}. The CI runner only executes ` +
          `${RUNNER_PROVIDER} agents — switch the agent's provider to ` +
          `${RUNNER_PROVIDER} to export it.`,
      );
    }

    if (input.target !== 'gha') {
      throw new ValidationError(
        `${input.target} export is not available yet. Only GitHub Actions is supported.`,
      );
    }

    // AC-66 — THE access-control boundary of the write path: the target
    // repository decides where the server's GitHub token writes, so it must
    // already be in the caller's workspace. Free text would let any caller aim
    // that credential at any repository the token can write to.
    const repoRow = await this.repo.findRepoByFullName(workspaceId, input.repo);
    if (!repoRow) {
      throw new ValidationError(
        `${input.repo} is not a repository in this workspace. Add it first, then export.`,
      );
    }

    // AC-68 — one agent per repository: the runner hard-fails when
    // `.devdigest/agents/` holds more than one manifest, and the commit path
    // cannot delete the existing one.
    const claimed = await this.repo.findInstallationByRepo(workspaceId, input.repo);
    if (claimed && claimed.agentId !== agentId) {
      const other = await this.container.agentsRepo.getById(workspaceId, claimed.agentId);
      throw new ValidationError(
        `${input.repo} already runs ${other?.name ?? 'another agent'} in CI. ` +
          'One agent per repository.',
      );
    }

    const existing = claimed?.agentId === agentId ? claimed : undefined;

    const agent: CiAgentInput = {
      name: agentRow.name,
      provider: agentRow.provider,
      model: agentRow.model,
      systemPrompt: agentRow.systemPrompt,
      strategy: agentRow.strategy,
      ciFailOn: agentRow.ciFailOn,
    };

    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const skills: CiSkillInput[] = links.map((l) => ({
      name: l.skill.name,
      body: l.skill.body,
      enabled: l.skill.enabled,
    }));

    // The ONLY filesystem read in this path. A missing or partially readable
    // bundle throws here — before any commit, PR or installation row exists.
    const runnerFiles = await readRunnerBundle(this.container.config.runnerDistDir);

    // AC-3 — on a re-export the manifest path comes from the STORED
    // installation, never from a freshly slugged (possibly renamed) agent name.
    const manifestPath = existing?.manifestPath || manifestPathFor(agentRow.name);
    const nextWorkflowVersion = (existing?.workflowVersion ?? 0) + 1;
    const triggers = normalizeTriggers(input.triggers);
    const postAs = normalizePostAs(input.post_as);

    const files = buildFileSet({
      agent,
      skills,
      runnerFiles,
      manifestPath,
      triggers,
      postAs,
      workflowVersion: nextWorkflowVersion,
      workflowOverride: input.workflow ?? null,
    });

    return {
      agent,
      agentId,
      agentCiFailOn: agentRow.ciFailOn,
      existing,
      repo: input.repo,
      targetType: input.target,
      postAs,
      triggers,
      base: input.base || repoRow.defaultBranch,
      manifestPath,
      nextWorkflowVersion,
      files,
    };
  }

  private previewResponse(
    workspaceId: string,
    p: Prepared,
    prUrl: string | null,
    installation?: CiInstallation,
  ): CiExport {
    return {
      installation:
        installation ??
        projectInstallationDto({
          existing: p.existing,
          workspaceId,
          agentId: p.agentId,
          repo: p.repo,
          targetType: p.targetType,
          postAs: p.postAs,
          triggers: p.triggers,
          base: p.base,
          manifestPath: p.manifestPath,
          workflowPath: WORKFLOW_PATH,
          workflowVersion: p.nextWorkflowVersion,
          agentCiFailOn: p.agentCiFailOn,
        }),
      // AC-71 — runner entries reduced to a size marker: the browser must never
      // receive ~1.6 MB of bundle text.
      files: toPreviewFiles(p.files),
      pr_url: prUrl,
      repo: p.repo,
      file_count: p.files.length,
    };
  }

  /** `action: 'files'` — generate and return the set. No commit, no row. */
  async generate(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    const prepared = await this.prepare(workspaceId, agentId, input);
    return this.previewResponse(workspaceId, prepared, prepared.existing?.prUrl ?? null);
  }

  // ---- install ------------------------------------------------------------

  /**
   * `action: 'open_pr'` — ONE atomic commit onto `devdigest/ci`, then
   * resolve-or-open the pull request, and only then persist the installation.
   *
   * Ordering is the AC-33 contract: a failed commit or a failed PR call
   * surfaces the underlying failure and records NO successful installation.
   */
  async install(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    const p = await this.prepare(workspaceId, agentId, input);
    const github = await this.container.github();
    const repoRef = parseRepoRef(p.repo);

    // AC-27/AC-28/AC-29: one commit, always onto CI_BRANCH (never the default
    // branch), layered onto the branch's own tip when it already exists.
    await github.commitFiles(repoRef, {
      branch: CI_BRANCH,
      base: p.base,
      message: COMMIT_MESSAGE,
      files: p.files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    // AC-30/AC-31: reuse an open PR for the branch, otherwise open exactly one.
    const open = await github.findOpenPr(repoRef, CI_BRANCH);
    const prUrl =
      open?.url ??
      (
        await github.openPullRequest(repoRef, {
          title: PR_TITLE,
          head: CI_BRANCH,
          base: p.base,
          body: buildPrBody(p.agent.name, p.files.length),
        })
      ).url;

    const row = await this.repo.upsertInstallation({
      workspaceId,
      agentId,
      repo: p.repo,
      targetType: p.targetType,
      postAs: p.postAs,
      triggers: p.triggers,
      baseBranch: p.base,
      manifestPath: p.manifestPath,
      workflowPath: WORKFLOW_PATH,
      prUrl,
      exportedCiFailOn: p.agent.ciFailOn,
    });

    return this.previewResponse(
      workspaceId,
      p,
      prUrl,
      toInstallationDto({
        row,
        lastStatus: null,
        lastActivityAt: null,
        agentCiFailOn: p.agentCiFailOn,
      }),
    );
  }

  /**
   * AC-78 — the degraded manual path: an archive of the SAME generated file set
   * (including the real runner bytes) with ZERO GitHub calls.
   */
  async zip(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    const p = await this.prepare(workspaceId, agentId, input);
    return {
      bytes: zipFiles(p.files.map((f) => ({ path: f.path, contents: f.contents }))),
      filename: `devdigest-ci-${p.repo.replace('/', '-')}.zip`,
    };
  }

  // ---- reads --------------------------------------------------------------

  /**
   * The CI Runs table plus the facets its filter chips need, in one round trip
   * (AC-51). The facets are "the distinct agents and repositories present in the
   * result set", exactly as the contract specifies — no second query.
   */
  async listRuns(workspaceId: string, filters: CiRunFilters): Promise<CiRunsResponse> {
    const rows = await this.repo.listCiRuns(workspaceId, filters);
    const agents = new Map<string, string>();
    const repos = new Set<string>();
    for (const r of rows) {
      if (r.agentId) agents.set(r.agentId, r.agentLiveName ?? r.run.agentName ?? '');
      if (r.run.repo) repos.add(r.run.repo);
    }
    return {
      runs: rows.map((r) => toCiRunDto(r.run, r.agentLiveName)),
      agents: [...agents].map(([id, name]) => ({ id, name })),
      repos: [...repos].sort(),
    };
  }

  /** The agent CI tab's rows, with the derived status and drift flag. */
  async installations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    return rows.map((r) =>
      toInstallationDto({
        row: r.installation,
        lastStatus: r.lastStatus,
        lastActivityAt: r.lastActivityAt,
        agentCiFailOn: agent.ciFailOn,
      }),
    );
  }
}

/** The exported pull request's body — explains what landed and what to do next. */
function buildPrBody(agentName: string, fileCount: number): string {
  return [
    `Adds the **${agentName}** DevDigest review agent to this repository's CI.`,
    '',
    `${fileCount} files: the agent manifest and its skills under \`.devdigest/\`, the`,
    'ncc-bundled reviewer under `.devdigest/runner/`, and the workflow at',
    `\`${WORKFLOW_PATH}\`.`,
    '',
    'The reviewer is vendored in this pull request and invoked directly — no',
    'marketplace action — so the code that runs is the code reviewed here.',
    '',
    'Before merging, add an `OPENROUTER_API_KEY` secret under',
    "Settings → Secrets and variables → Actions. Fork pull requests are skipped by the",
    'workflow, and the job is granted only `contents: read` + `pull-requests: write`.',
  ].join('\n');
}
