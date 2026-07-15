import type { DevDigestApi } from '../src/ports/devdigest-api.js';
import type { Agent } from '../src/vendor/shared/agent.js';
import type { Repo, PrMeta } from '../src/vendor/shared/platform.js';
import type { RunSummary } from '../src/vendor/shared/run.js';
import type { ReviewRecord } from '../src/vendor/shared/findings.js';
import type { ConventionCandidate } from '../src/vendor/shared/knowledge.js';

/** In-memory fake of the `DevDigestApi` port for unit/integration tests —
 *  no fetch, no server required. */
export class FakeDevDigestApi implements DevDigestApi {
  agents: Agent[] = [];
  repos: Repo[] = [];
  pulls: Record<string, PrMeta[]> = {};
  runs: Record<string, RunSummary[]> = {};
  reviews: Record<string, ReviewRecord[]> = {};
  conventions: Record<string, { candidates: ConventionCandidate[]; scanned_at: string | null }> = {};
  triggeredCalls: { prId: string; agentId: string }[] = [];
  nextRunId = 'run-1';
  /** Test hook: flips the most recent run to this status on the NEXT
   *  `listRuns` call, then clears itself — lets tests deterministically
   *  simulate "the review finished during the bounded wait" without a real
   *  timer. */
  completeOnNextPoll: { status: 'done' | 'failed' | 'cancelled'; error?: string } | null = null;

  async listAgents(opts?: { enabledOnly?: boolean }): Promise<Agent[]> {
    if (opts?.enabledOnly === false) return this.agents;
    return this.agents.filter((a) => a.enabled);
  }

  async listRepos(): Promise<Repo[]> {
    return this.repos;
  }

  async listPulls(repoId: string): Promise<PrMeta[]> {
    return this.pulls[repoId] ?? [];
  }

  async triggerReview(
    prId: string,
    agentId: string,
  ): Promise<{ run_id: string; agent_id: string; agent_name: string }[]> {
    this.triggeredCalls.push({ prId, agentId });
    const agent = this.agents.find((a) => a.id === agentId);
    const run = { run_id: this.nextRunId, agent_id: agentId, agent_name: agent?.name ?? 'unknown' };
    this.runs[prId] = [
      ...(this.runs[prId] ?? []),
      { run_id: run.run_id, agent_id: agentId, agent_name: run.agent_name, status: 'running', error: null, ran_at: null },
    ];
    return [run];
  }

  async listRuns(prId: string): Promise<RunSummary[]> {
    const rows = this.runs[prId] ?? [];
    if (this.completeOnNextPoll) {
      const last = rows[rows.length - 1];
      if (last) {
        last.status = this.completeOnNextPoll.status;
        if (this.completeOnNextPoll.error !== undefined) last.error = this.completeOnNextPoll.error;
      }
      this.completeOnNextPoll = null;
    }
    return rows;
  }

  async listReviews(prId: string): Promise<ReviewRecord[]> {
    return this.reviews[prId] ?? [];
  }

  async listConventions(
    repoId: string,
  ): Promise<{ candidates: ConventionCandidate[]; scanned_at: string | null }> {
    return this.conventions[repoId] ?? { candidates: [], scanned_at: null };
  }

  /** Test helper: flip a previously-triggered run to a terminal status. */
  completeRun(prId: string, runId: string, status: 'done' | 'failed' | 'cancelled', error?: string) {
    const run = (this.runs[prId] ?? []).find((r) => r.run_id === runId);
    if (run) {
      run.status = status;
      if (error !== undefined) run.error = error;
    }
  }
}
