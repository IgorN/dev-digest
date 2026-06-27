import type { Container } from '../../platform/container.js';
import type { ConventionCandidate } from '@devdigest/shared';
import type { RepoRow } from '../../db/rows.js';
import { ValidationError } from '../../platform/errors.js';
import { ConventionsRepository } from './repository.js';
import { ConventionsContent } from './content.js';
import { extractCandidates } from './extract.js';
import { verifyCandidates } from './verify.js';
import { toConventionDto, type RepoRef } from './helpers.js';
import { buildSkillDraft, type SkillDraft } from './skill-draft.js';
import { EXTRACTION_MODEL, EXTRACTION_PROVIDER, SAMPLE_LIMIT } from './constants.js';

/**
 * Conventions extractor service.
 *
 * Pipeline (extract): sample repo files (code-only) → cheap-model proposes
 * candidates → verify each against real file content (drop the unverifiable) →
 * persist as undecided candidates. The UI then accepts/rejects/edits them and
 * merges the accepted ones into the `repo-conventions` skill.
 */

export interface ConventionsList {
  candidates: ConventionCandidate[];
  sample_count: number | null;
  scanned_at: string | null;
}

export interface ExtractResultDto extends ConventionsList {
  /** How many the model proposed vs how many survived evidence verification. */
  proposed: number;
  verified: number;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private content: ConventionsContent;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.content = new ConventionsContent(container.db, container);
  }

  private getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    return this.repo.getRepo(workspaceId, repoId);
  }

  private refOf(repo: RepoRow): RepoRef {
    return { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch };
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionsList | undefined> {
    const repo = await this.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const rows = await this.repo.listForRepo(repoId);
    return {
      candidates: rows.map((r) => toConventionDto(r, this.refOf(repo))),
      sample_count: repo.conventionsSampleCount ?? null,
      scanned_at: repo.conventionsScannedAt?.toISOString() ?? null,
    };
  }

  /** Run a fresh scan: sample → model → verify → persist. */
  async extract(workspaceId: string, repoId: string): Promise<ExtractResultDto | undefined> {
    const repo = await this.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const allPaths = await this.content.availablePaths(repo);
    if (allPaths.length === 0) {
      throw new ValidationError(
        'No readable code for this repository — sync/clone it (or index it) before extracting conventions.',
      );
    }
    const samplePaths = await this.content.pickSamples(repoId, allPaths, SAMPLE_LIMIT);
    const contentMap = await this.content.loadContent(repo, samplePaths);
    const sampleFiles = [...contentMap.entries()].map(([path, content]) => ({ path, content }));
    if (sampleFiles.length === 0) {
      throw new ValidationError('Could not read any sampled file content for this repository.');
    }

    const llm = await this.container.llm(EXTRACTION_PROVIDER);
    const { candidates: raw } = await extractCandidates(
      llm,
      EXTRACTION_MODEL,
      sampleFiles,
      `conventions:${repo.fullName}`,
    );

    // Trust nothing the model said until the snippet is found in real code.
    const verified = verifyCandidates(raw, contentMap);
    await this.repo.replaceForRepo(workspaceId, repoId, verified);

    const scannedAt = new Date();
    await this.repo.markScanned(workspaceId, repoId, scannedAt, sampleFiles.length);

    const rows = await this.repo.listForRepo(repoId);
    return {
      candidates: rows.map((r) => toConventionDto(r, this.refOf(repo))),
      sample_count: sampleFiles.length,
      scanned_at: scannedAt.toISOString(),
      proposed: raw.length,
      verified: verified.length,
    };
  }

  /** Accept / reject / edit a single candidate. */
  async update(
    workspaceId: string,
    id: string,
    patch: { accepted?: boolean | null; rule?: string; category?: string | null },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) return undefined;
    const repo = row.repoId ? await this.getRepo(workspaceId, row.repoId) : undefined;
    // No repo ref (repo deleted / null) → omit the evidence_url rather than emit
    // a broken github.com/unknown/unknown link.
    return repo ? toConventionDto(row, this.refOf(repo)) : toConventionDto(row, null);
  }

  /** Bulk accept / reject every candidate of a repo. */
  async setAll(workspaceId: string, repoId: string, accepted: boolean): Promise<boolean> {
    const repo = await this.getRepo(workspaceId, repoId);
    if (!repo) return false;
    await this.repo.setAcceptedForRepo(workspaceId, repoId, accepted);
    return true;
  }

  /** Build the (non-persisted) `repo-conventions` skill draft from accepted
   *  candidates, for the "Create skill from conventions" modal. */
  async skillDraft(workspaceId: string, repoId: string): Promise<SkillDraft | undefined> {
    const repo = await this.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const accepted = await this.repo.acceptedForRepo(repoId);
    return buildSkillDraft(repo.name, accepted);
  }
}
