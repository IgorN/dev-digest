import { z, type ZodType } from 'zod';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import { UpstreamHttpError } from '../ports/devdigest-api.js';
import { Agent } from '../vendor/shared/agent.js';
import { Repo, PrMeta } from '../vendor/shared/platform.js';
import { RunSummary } from '../vendor/shared/run.js';
import { ReviewRecord } from '../vendor/shared/findings.js';
import { ConventionCandidate } from '../vendor/shared/knowledge.js';

const TriggerReviewResult = z.object({
  runs: z.array(z.object({ run_id: z.string(), agent_id: z.string(), agent_name: z.string() })),
});

const ConventionsResult = z.object({
  candidates: z.array(ConventionCandidate),
  scanned_at: z.string().nullable(),
});

/**
 * Infrastructure ring — the ONLY module that speaks HTTP. Talks to the
 * existing, already-running DevDigest API (approved-plan A1: reuse the HTTP
 * layer rather than a second, duplicate Drizzle/DB access path). No auth
 * header today — the API's `LocalNoAuthProvider` always resolves the same
 * seeded workspace (server/src/adapters/auth/local.ts), so a local caller
 * needs no credentials in this MVP (risk R2 in the approved plan).
 *
 * Every response is validated against the vendored Zod schema for its shape
 * before it leaves this ring — this is the one I/O seam where a drifted
 * upstream contract (server/src/vendor/shared/ changed but this package's
 * hand-synced copy wasn't) would otherwise leak an `any`-shaped value into
 * the application ring instead of failing loudly.
 */
export class HttpDevDigestApi implements DevDigestApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch (err) {
      throw new UpstreamHttpError(
        0,
        'network_error',
        `Could not reach the DevDigest API at ${this.baseUrl}${path}: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = `DevDigest API returned ${res.status} for ${path}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      throw new UpstreamHttpError(res.status, code, message);
    }
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamHttpError(
        res.status,
        'upstream_contract_mismatch',
        `DevDigest API response for ${path} didn't match the expected shape (upstream contract may have drifted from this package's vendored copy): ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async listAgents(opts?: { enabledOnly?: boolean }): Promise<Agent[]> {
    const agents = await this.request('/agents', z.array(Agent));
    return opts?.enabledOnly === false ? agents : agents.filter((a) => a.enabled);
  }

  listRepos(): Promise<Repo[]> {
    return this.request('/repos', z.array(Repo));
  }

  listPulls(repoId: string): Promise<PrMeta[]> {
    return this.request(`/repos/${repoId}/pulls`, z.array(PrMeta));
  }

  async triggerReview(
    prId: string,
    agentId: string,
  ): Promise<{ run_id: string; agent_id: string; agent_name: string }[]> {
    const result = await this.request(`/pulls/${prId}/review`, TriggerReviewResult, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    });
    return result.runs;
  }

  listRuns(prId: string): Promise<RunSummary[]> {
    return this.request(`/pulls/${prId}/runs`, z.array(RunSummary));
  }

  listReviews(prId: string): Promise<ReviewRecord[]> {
    return this.request(`/pulls/${prId}/reviews`, z.array(ReviewRecord));
  }

  listConventions(
    repoId: string,
  ): Promise<{ candidates: ConventionCandidate[]; scanned_at: string | null }> {
    return this.request(`/repos/${repoId}/conventions`, ConventionsResult);
  }
}
