import type { Onboarding } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Logger } from '../reviews/run-executor.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { OnboardingRepository } from './repository.js';
import { gatherFacts } from './facts.js';
import { buildSkeleton } from './skeleton.js';
import { generateOnboarding } from './generate.js';

/**
 * Onboarding tour service — application ring (design mirrors `blast`).
 *
 * `get` reads the persisted tour and spends nothing (AC-1/AC-2). `recompute`
 * gathers deterministic facts, builds the skeleton FIRST (so a valid tour always
 * exists — Rec-4), then enriches it with exactly ONE `completeStructured` call
 * via `generate.ts` — and only when the index is usable. Every failure mode
 * (degraded/absent index, no clone, or an LLM throw) degrades to that skeleton;
 * this service NEVER surfaces a 5xx for a degraded index or a failed model call
 * (AC-11/AC-12). Both reads and writes are workspace-scoped through
 * `repository.getRepo` (AC-21).
 */

/**
 * `degraded_reason` stamped when the index WAS usable but the single narrative
 * call failed — the tour is a valid skeleton, just not model-enriched. We also
 * flip `index_state` to `degraded` so the client's index-state-driven badge
 * surfaces the fallback (AC-12/AC-14).
 */
const LLM_FAILURE_REASON =
  'The onboarding narrative could not be generated; showing a deterministic skeleton built from the index.';

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * The persisted tour for a repo, or `undefined` when never generated. Scoped
   * to the caller's workspace: a repo in another workspace is not-found (AC-21).
   * Zero LLM calls (AC-1/AC-2).
   */
  async get(workspaceId: string, repoId: string): Promise<Onboarding | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return this.repo.getTour(repoId);
  }

  /**
   * Gather facts → deterministic skeleton → (when the index is usable) one
   * narrative LLM call → upsert → return. Degrades to the skeleton, never a 5xx,
   * on a degraded/absent index (AC-11) or any LLM failure (AC-12).
   */
  async recompute(workspaceId: string, repoId: string, logger?: Logger): Promise<Onboarding> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Deterministic, zero-LLM facts + skeleton — the base AND the fallback (AC-11).
    const facts = await gatherFacts(this.container, repo);
    const skeleton = buildSkeleton(facts);

    let tour: Onboarding = skeleton;

    // Enrich only when the index is usable; a degraded/absent index or no clone
    // keeps the skeleton verbatim (its `index_state`/`degraded_reason` already
    // carry the honest marker from `gatherFacts`).
    if (!facts.indexState.degraded) {
      try {
        const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
        const llm = await this.container.llm(provider);
        const result = await generateOnboarding(llm, model, facts);
        // The one cost log line for this feature (AC-15) — logged, not persisted.
        logger?.info(
          { repoId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd },
          'onboarding: narrative call complete',
        );
        tour = result.onboarding;
      } catch (err) {
        // AC-12: the narrative call failed — keep the skeleton, mark it degraded
        // with a surfaced reason, and never bubble a 5xx.
        logger?.warn({ repoId, err }, 'onboarding: narrative call failed; using skeleton');
        tour = { ...skeleton, index_state: 'degraded', degraded_reason: LLM_FAILURE_REASON };
      }
    }

    // upsert stamps `generated_at` and folds it back into the returned payload.
    return this.repo.upsertTour(repoId, tour);
  }
}
