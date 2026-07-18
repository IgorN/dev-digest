import type { DevDigestApi } from '../src/ports/devdigest-api.js';
import type { Agent } from '../src/vendor/shared/agent.js';
import type { Repo, PrMeta } from '../src/vendor/shared/platform.js';
import type { RunSummary } from '../src/vendor/shared/run.js';
import type { ReviewRecord } from '../src/vendor/shared/findings.js';
import type { ConventionCandidate } from '../src/vendor/shared/knowledge.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import type { GitClient } from '../src/ports/git.js';

/** Minimal fake `LLMProvider` for exercising the REAL `reviewPullRequest`
 *  engine end-to-end (same philosophy as reviewer-core's own tests: a
 *  stubbed provider, no keys/network) — only `completeStructured` is
 *  implemented, matching the real `OpenRouterProvider`'s own contract
 *  (`complete()` is an intentional throwing stub there too). */
export class FakeLLMProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  calls: StructuredRequest<unknown>[] = [];

  constructor(private readonly structuredData: unknown) {}

  async listModels(): Promise<ModelInfo[]> {
    throw new Error('FakeLLMProvider.listModels not implemented');
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('FakeLLMProvider.complete not implemented — use completeStructured');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    return {
      data: this.structuredData as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(this.structuredData),
      attempts: 1,
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('FakeLLMProvider.embed not implemented');
  }
}

/** In-memory fake of the `GitClient` port. */
export class FakeGitClient implements GitClient {
  diffByCwd: Record<string, string> = {};

  async workingTreeDiff(cwd: string): Promise<string> {
    return this.diffByCwd[cwd] ?? '';
  }
}

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
