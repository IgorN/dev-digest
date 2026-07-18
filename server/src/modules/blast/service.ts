import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { Logger } from '../reviews/run-executor.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { shapeBlastRadius } from './helpers.js';
import { summarizeBlastRadius } from './summarize.js';
import { NO_SYMBOLS_SUMMARY } from './constants.js';

/**
 * Blast radius service — "what could these changes break?", read entirely
 * from the already-built repo-intel index (no parsing on this hot path; see
 * `container.repoIntel.getBlastRadius`). The only LLM call in this feature is
 * the one-paragraph `summary` — skipped entirely when there's nothing to
 * summarize (zero changed symbols found in the index).
 *
 * Route shape mirrors `intent`'s (design decision E, reused here): fully
 * synchronous, `GET` reads the persisted map or `null`, `POST .../recompute`
 * is the one explicit user action that computes + persists + returns it.
 */
export class BlastService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /** The persisted BlastRadius for a PR, or `undefined` when never computed. */
  async get(workspaceId: string, prId: string): Promise<BlastRadius | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.repo.getBriefBlast(prId);
  }

  /**
   * Recompute: changed file paths -> repo-intel facade -> pure shaping ->
   * (maybe) one cheap LLM call for the summary -> persist -> return.
   */
  async recompute(workspaceId: string, prId: string, logger?: Logger): Promise<BlastRadius> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const files = await this.repo.getPrFiles(prId);
    const changedFiles = files.map((f) => f.path);

    const result = await this.container.repoIntel.getBlastRadius(repo.id, changedFiles);
    const shaped = shapeBlastRadius(result);

    logger?.info(
      {
        prId,
        changedFileCount: changedFiles.length,
        changedSymbolCount: shaped.changed_symbols.length,
        downstreamSymbolCount: shaped.downstream.length,
        callerCount: shaped.downstream.reduce((n, d) => n + d.callers.length, 0),
        degraded: shaped.degraded,
        degradedReason: shaped.degraded_reason,
      },
      'blast: repo-intel map computed',
    );

    let summary: string;
    if (shaped.changed_symbols.length === 0) {
      summary = NO_SYMBOLS_SUMMARY;
    } else {
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'blast_radius');
      const llm = await this.container.llm(provider);
      const summarized = await summarizeBlastRadius(llm, model, shaped.changed_symbols, shaped.downstream);
      summary = summarized.summary;
      logger?.info(
        { prId, tokensIn: summarized.tokensIn, tokensOut: summarized.tokensOut, costUsd: summarized.costUsd },
        'blast: summary call complete',
      );
    }

    const blast: BlastRadius = { ...shaped, summary };
    await this.repo.upsertBriefBlast(prId, blast);
    return blast;
  }
}
