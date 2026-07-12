import type { Intent, PrDetail } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository, type PullRow } from '../reviews/repository.js';
import type { Logger } from '../reviews/run-executor.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { classifyIntent } from './extract.js';

/**
 * Intent service — derives a cheap, structured "why was this PR opened"
 * (summary + in_scope/out_of_scope) before the main review runs.
 *
 * Reuses the SAME `loadDiff` the main review uses (design decision D), so the
 * classifier is callable standalone — before any review has run for the PR —
 * rather than depending on a prior review pass having already loaded a diff.
 *
 * Persistence goes through the EXISTING `ReviewRepository.getIntent`/
 * `upsertIntent` (backed by the `pr_intent` table, already the right shape) —
 * no new query layer, no duplicate DB access for the `intent` domain.
 */
export class IntentService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /** The persisted Intent for a PR, or `undefined` when never computed. */
  async get(workspaceId: string, prId: string): Promise<Intent | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.repo.getIntent(prId);
  }

  /**
   * Recompute: load PrDetail + diff, run the classifier, persist, return the
   * fresh Intent. Synchronous — a single cheap LLM call (design decision E),
   * same latency/cost profile as the conventions extractor.
   */
  async recompute(workspaceId: string, prId: string, logger?: Logger): Promise<Intent> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const [prDetail, diff] = await Promise.all([
      this.resolvePrDetail(pull, repo),
      loadDiff(this.container, this.repo, workspaceId, pull, repo),
    ]);

    // Composed-input sizes only — NEVER the diff body. Logged before the LLM
    // call so a leak of diff content would be visible by its absence here.
    const hunkLineCount = diff.files.reduce((n, f) => n + f.hunks.length, 0);
    logger?.info(
      {
        prId,
        titleLength: prDetail.title.length,
        bodyLength: prDetail.body?.length ?? 0,
        linkedIssuePresent: prDetail.linked_issue != null,
        fileCount: diff.files.length,
        hunkHeaderLineCount: hunkLineCount,
      },
      'intent: composed classifier input',
    );

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider);

    const result = await classifyIntent(llm, model, prDetail, diff, `intent:${repo.owner}/${repo.name}#${pull.number}`);

    logger?.info(
      { prId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd },
      'intent: classifier call complete',
    );

    await this.repo.upsertIntent(prId, result.intent);
    return result.intent;
  }

  /**
   * Best-effort live PrDetail (title/body/linked_issue) via GitHub, mirroring
   * the local-first fallback in `pulls/routes.ts`'s `GET /pulls/:id`: when no
   * token is configured / GitHub is unreachable, fall back to the persisted
   * PullRow (no `linked_issue` — it's never persisted locally) rather than
   * failing the recompute. Files/commits aren't needed here, so they're
   * omitted from the fallback rather than re-fetched from `pr_files`.
   */
  private async resolvePrDetail(
    pull: PullRow,
    repo: { owner: string; name: string },
  ): Promise<PrDetail> {
    try {
      const gh = await this.container.github();
      return await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
    } catch {
      return {
        id: pull.id,
        number: pull.number,
        title: pull.title,
        author: pull.author,
        branch: pull.branch,
        base: pull.base,
        head_sha: pull.headSha,
        additions: pull.additions,
        deletions: pull.deletions,
        files_count: pull.filesCount,
        status: pull.status as PrDetail['status'],
        opened_at: pull.openedAt?.toISOString() ?? null,
        updated_at: pull.updatedAt?.toISOString() ?? null,
        body: pull.body ?? null,
        files: [],
        commits: [],
        linked_issue: null,
      };
    }
  }
}
