import type { IssueMeta, SmartDiffRole, WhyRiskBrief } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository, type PullRow } from '../reviews/repository.js';
import type { Logger } from '../reviews/run-executor.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { ContextService } from '../context/service.js';
import { truncateToBytes } from '../context/helpers.js';
import { rollupSeverities, latestReviewsPerAgent, type SeverityCounts } from '../pulls/status.js';
import { buildBriefMessages } from './assemble.js';
import {
  buildDegradedSkeleton,
  buildGroundingSet,
  groundBrief,
  selectContextDocs,
  summarizeSmartDiffCounts,
} from './helpers.js';
import { synthesizeBrief } from './synthesize.js';
import { CONTEXT_DOC_MAX_CHARS, CONTEXT_DOC_MAX_COUNT, LLM_FAILURE_REASON } from './constants.js';

/**
 * Why + Risk Brief service — application ring, the orchestration point for
 * every AC in this feature (design mirrors `BlastService`/`IntentService`
 * exactly: constructor shape, `get`/`recompute` split, skeleton-first
 * fallback borrowed from `OnboardingService`).
 *
 * `get` resolves the pull (workspace-scoped, AC-20) and reads the persisted
 * brief — zero LLM calls (AC-3). `recompute` gathers the six already-
 * computed/reused inputs via `Promise.all` (persisted intent, persisted
 * blast, deterministic smart-diff group counts, a live linked-issue fetch, a
 * bounded context-docs read, and a findings-severity rollup — AD-5), builds
 * the degraded skeleton FIRST so a valid brief always exists (AC-11), then
 * attempts the feature's ONE
 * `completeStructured` call (`synthesizeBrief`, T4) and grounds its file
 * references (`groundBrief`, T3). Any failure in that one synthesis step —
 * missing model config, a throwing provider, a schema mismatch — falls back
 * to the pre-built skeleton; a missing individual INPUT (no intent,
 * degraded/absent blast, no linked issue, no context docs) instead degrades
 * what the brief content CAN say, not the recompute itself (AC-8, AC-9,
 * AC-10, AC-13).
 *
 * This service NEVER calls `IntentService.recompute` / `BlastService.recompute`
 * — only their persisted-read paths — and NEVER calls `.complete()` on an LLM
 * provider; only `synthesize.ts` talks to the provider, via `completeStructured`.
 */
export class WhyRiskBriefService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /**
   * The persisted WhyRiskBrief for a PR, or `undefined` when never computed
   * (the route maps that to a `200` with a null body — AC-4). Workspace-
   * scoped via `getPull`: a PR outside the caller's workspace is not-found,
   * never leaking another workspace's brief (AC-20). Zero LLM calls (AC-3).
   */
  async get(workspaceId: string, prId: string): Promise<WhyRiskBrief | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.repo.getBriefWhyRisk(prId);
  }

  /**
   * Gather the five inputs -> assemble -> the one synthesis call -> ground
   * file refs -> persist -> return. Workspace-scoped via `getPull`/`getRepo`
   * (AC-20).
   */
  async recompute(workspaceId: string, prId: string, logger?: Logger): Promise<WhyRiskBrief> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const [intent, blast, smartDiffCounts, files, linkedIssue, contextDocs, findingsSummary] =
      await Promise.all([
        this.repo.getIntent(prId), // AC-8: undefined tolerated
        this.repo.getBriefBlast(prId), // AC-9: undefined tolerated
        this.gatherSmartDiffCounts(workspaceId, prId), // Rec-4: read-only, zero-LLM cross-module call
        this.repo.getPrFiles(prId), // grounding-set input
        this.resolveLinkedIssue(pull, repo), // AC-10: null on no token / offline / GitHub error
        this.gatherContextDocs(workspaceId, repo.id), // AC-12/AC-13: [] with no usable clone
        this.gatherFindingsSummary(prId), // AD-5: read-only, zero-LLM cross-module rollup
      ]);

    const groundingSet = buildGroundingSet(files, blast);

    // Built FIRST, before the synthesis call is even attempted, so a valid
    // brief always exists to fall back to (AC-11).
    const skeleton = buildDegradedSkeleton(pull.title, intent, LLM_FAILURE_REASON);

    let brief: WhyRiskBrief;
    try {
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      const llm = await this.container.llm(provider);
      const messages = buildBriefMessages({
        prTitle: pull.title,
        intent,
        blast,
        smartDiffCounts,
        linkedIssue,
        contextDocs,
        findingsSummary,
      });
      const result = await synthesizeBrief(
        llm,
        model,
        messages,
        `why-risk-brief:${repo.owner}/${repo.name}#${pull.number}`,
      );
      const grounded = groundBrief(result.data, groundingSet);
      brief = {
        ...grounded,
        degraded: false,
        degraded_reason: null,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      };
      logger?.info(
        { prId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd },
        'why-risk-brief: synthesis call complete',
      );
    } catch (err) {
      // AC-11: the synthesis call (or anything upstream of it in this block)
      // failed — keep the pre-built skeleton, never bubble a 5xx.
      logger?.warn({ prId, err }, 'why-risk-brief: synthesis failed; using skeleton');
      brief = skeleton;
    }

    await this.repo.upsertBriefWhyRisk(prId, brief);
    return brief;
  }

  /**
   * Deterministic smart-diff group counts. A deliberate, read-only, zero-LLM
   * cross-module `Service` call (Rec-4) — reuses `SmartDiffService.get()`
   * (itself already zero-LLM and stateless) rather than re-deriving file
   * classification here; only `.groups[].role`/`.files.length` survive into
   * `summarizeSmartDiffCounts`'s output, everything else `SmartDiffService`
   * computes (findings, split suggestion) is discarded.
   */
  private async gatherSmartDiffCounts(
    workspaceId: string,
    prId: string,
  ): Promise<{ role: SmartDiffRole; count: number }[]> {
    const smartDiff = await new SmartDiffService(this.container).get(workspaceId, prId);
    return summarizeSmartDiffCounts(smartDiff);
  }

  /**
   * Deterministic findings-severity rollup (AD-5) — the same
   * `latestReviewsPerAgent` + `rollupSeverities` pair the PR-list route uses,
   * just scoped to one PR via the already-available `reviewsForPull`. Only
   * `kind: 'review'` reviews count (mirrors the PR-list route's filter,
   * excluding 'summary'-kind reviews), only the newest review per agent
   * counts (a re-run never double-counts its own superseded findings), and
   * dismissed findings are excluded — so a stale or acknowledged finding
   * never inflates `risk_level`. Zero new DB queries beyond what
   * `reviewsForPull` already runs; zero LLM calls.
   */
  private async gatherFindingsSummary(prId: string): Promise<SeverityCounts> {
    const reviews = (await this.repo.reviewsForPull(prId)).filter((r) => r.review.kind === 'review');
    const keptIds = new Set(latestReviewsPerAgent(reviews.map((r) => r.review)).map((r) => r.id));
    const findings = reviews
      .filter((r) => keptIds.has(r.review.id))
      .flatMap((r) => r.findings)
      .filter((f) => f.dismissedAt == null);
    return rollupSeverities(findings);
  }

  /**
   * Best-effort live linked-issue fetch (AC-10). Deliberately calls the same
   * PUBLIC `gh.getPullRequest` method `IntentService.resolvePrDetail` and
   * `pulls/routes.ts` already call — never the private
   * `OctokitGitHubClient.resolveLinkedIssue` — just reading `.linked_issue`
   * off the result instead of the rest of `PrDetail`. No token / offline /
   * any GitHub error -> `null`, swallowed here so a linked-issue fetch never
   * fails the recompute.
   */
  private async resolveLinkedIssue(
    pull: PullRow,
    repo: { owner: string; name: string },
  ): Promise<IssueMeta | null> {
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
      return detail.linked_issue ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Bounded, capped context-docs gather (AC-12/AC-13). No usable clone -> `[]`
   * (AC-13), checked via `has_clone`, mirroring `ContextService`'s own
   * empty-inventory contract. Otherwise `selectContextDocs` (T3) picks at
   * most `CONTEXT_DOC_MAX_COUNT` docs deterministically, and each is read via
   * `ContextService.preview`, capped at `CONTEXT_DOC_MAX_CHARS`.
   *
   * `ContextService.preview()` already wraps its own clone read in a
   * try/catch and turns a throw into `NotFoundError` — the try/catch HERE is
   * a second, necessary layer: a doc can vanish between the `.inventory()`
   * read above and this per-doc `.preview()` read, or `.preview()` can throw
   * on an edge case (e.g. a path that no longer matches a configured root).
   * Either way, that one doc is skipped silently — a clone-read failure must
   * never surface as an error (AC-13); the brief just has fewer context docs.
   */
  private async gatherContextDocs(
    workspaceId: string,
    repoId: string,
  ): Promise<{ path: string; content: string }[]> {
    const contextService = new ContextService(this.container);
    const inventory = await contextService.inventory(workspaceId, repoId);
    if (!inventory || !inventory.has_clone) return [];

    const selected = selectContextDocs(inventory.items, CONTEXT_DOC_MAX_COUNT);
    const docs: { path: string; content: string }[] = [];
    for (const item of selected) {
      try {
        const preview = await contextService.preview(workspaceId, repoId, item.path);
        if (!preview) continue;
        docs.push({
          path: item.path,
          content: truncateToBytes(preview.content, CONTEXT_DOC_MAX_CHARS).text,
        });
      } catch {
        // Unreadable between inventory and preview, or an edge-case throw —
        // skip this doc silently (AC-13), never propagate.
      }
    }
    return docs;
  }
}
