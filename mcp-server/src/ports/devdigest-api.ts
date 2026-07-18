import type { Agent } from '../vendor/shared/agent.js';
import type { Repo, PrMeta } from '../vendor/shared/platform.js';
import type { RunSummary } from '../vendor/shared/run.js';
import type { ReviewRecord } from '../vendor/shared/findings.js';
import type { ConventionCandidate } from '../vendor/shared/knowledge.js';

/**
 * Ports ring — the interface use-cases (application ring) depend on via DIP.
 * No concrete transport (fetch, Drizzle, …) is named here; `infra/http-client.ts`
 * implements it against the existing DevDigest HTTP API (approved-plan A1).
 */
export interface DevDigestApi {
  listAgents(opts?: { enabledOnly?: boolean }): Promise<Agent[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  /** POST /pulls/:id/review with a single agentId — fire-and-forget on the
   *  server; resolves with the created run row(s) immediately. */
  triggerReview(
    prId: string,
    agentId: string,
  ): Promise<{ run_id: string; agent_id: string; agent_name: string }[]>;
  /** All runs for a PR (any status), newest first. */
  listRuns(prId: string): Promise<RunSummary[]>;
  /** Persisted reviews (+ findings) for a PR. */
  listReviews(prId: string): Promise<ReviewRecord[]>;
  /** GET /repos/:id/conventions — `scanned_at` is null until the repo has
   *  ever been through the (separate, expensive) extraction pass. */
  listConventions(repoId: string): Promise<{ candidates: ConventionCandidate[]; scanned_at: string | null }>;
}

/** Thrown by any `DevDigestApi` implementation for a non-2xx upstream
 *  response. Carries the upstream `{error:{code,message}}` envelope
 *  (server/src/platform/errors.ts) so use-cases can build an actionable
 *  domain error (image rule #4) with the specific context they have
 *  (which repo/PR/agent/run was being resolved). */
export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly upstreamCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}
