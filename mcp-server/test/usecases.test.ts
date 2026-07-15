import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDevDigestApi } from './fakes.js';
import { makeListAgentsUseCase } from '../src/app/list-agents.usecase.js';
import { makeRunAgentOnPullRequestUseCase } from '../src/app/run-agent-on-pull-request.usecase.js';
import { makeGetFindingsUseCase } from '../src/app/get-findings.usecase.js';
import { makeGetConventionsUseCase } from '../src/app/get-conventions.usecase.js';
import { makeGetBlastRadiusUseCase } from '../src/app/get-blast-radius.usecase.js';
import { RunPrCache } from '../src/app/run-pr-cache.js';
import { McpToolError } from '../src/domain/errors.js';

const noopSleep = async () => {};

function seedRepoAndAgent(api: FakeDevDigestApi) {
  api.repos = [{ id: 'repo-1', owner: 'owner', name: 'repo', full_name: 'owner/repo' }];
  api.agents = [
    { id: 'agent-1', name: 'Strict Reviewer', description: 'd', provider: 'anthropic', model: 'm', enabled: true },
  ];
  api.pulls['repo-1'] = [{ id: 'pr-1', number: 42, title: 'Add feature' }];
}

describe('list_agents use-case', () => {
  it('returns only enabled agents by default, narrowed', async () => {
    const api = new FakeDevDigestApi();
    api.agents = [
      { id: 'a1', name: 'On', description: 'd', provider: 'anthropic', model: 'm', enabled: true },
      { id: 'a2', name: 'Off', description: 'd', provider: 'anthropic', model: 'm', enabled: false },
    ];
    const listAgents = makeListAgentsUseCase({ api });
    const result = await listAgents({});
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.name).toBe('On');
  });
});

describe('run_agent_on_pull_request use-case', () => {
  let api: FakeDevDigestApi;
  let cache: RunPrCache;

  beforeEach(() => {
    api = new FakeDevDigestApi();
    cache = new RunPrCache();
    seedRepoAndAgent(api);
  });

  it('returns findings inline when the run finishes within the wait window', async () => {
    api.completeOnNextPoll = { status: 'done' };
    api.reviews['pr-1'] = [
      {
        run_id: 'run-1',
        verdict: 'request_changes',
        findings: [
          {
            id: 'f1',
            severity: 'CRITICAL',
            category: 'bug',
            title: 'Bug',
            file: 'a.ts',
            start_line: 1,
            end_line: 2,
            rationale: 'because',
            suggestion: null,
            confidence: 0.9,
          },
        ],
      },
    ];
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 6,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });

    const result = await useCase({ repo: 'owner/repo', pr_number: 42, agent: 'Strict Reviewer', wait_seconds: 1 });

    expect(result.status).toBe('done');
    expect(result.run_id).toBe('run-1');
    if (result.status === 'done') {
      expect(result.verdict).toBe('request_changes');
      expect(result.findings).toHaveLength(1);
      expect(result.next_action).toBeNull();
    }
    expect(cache.prFor('run-1')).toBe('pr-1');
  });

  it('resolves the agent case-insensitively by name or by id', async () => {
    api.completeOnNextPoll = { status: 'done' };
    api.reviews['pr-1'] = [{ run_id: 'run-1', verdict: 'approve', findings: [] }];
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });
    const result = await useCase({ repo: 'owner/repo', pr_number: 42, agent: 'strict reviewer', wait_seconds: 1 });
    expect(result.status).toBe('done');
  });

  it('returns run_id + status running when the wait window elapses first', async () => {
    // completeOnNextPoll stays null -> every poll still sees 'running'.
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });
    const result = await useCase({ repo: 'owner/repo', pr_number: 42, agent: 'agent-1', wait_seconds: 1 });
    expect(result.status).toBe('running');
    if (result.status === 'running') {
      expect(result.next_action).toContain('run-1');
    }
    expect(cache.prFor('run-1')).toBe('pr-1');
  });

  it('throws an actionable error when the agent is not found (image rule #4)', async () => {
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });
    await expect(
      useCase({ repo: 'owner/repo', pr_number: 42, agent: 'nonexistent', wait_seconds: 1 }),
    ).rejects.toMatchObject({ code: 'agent_not_found', message: expect.stringContaining('list_agents') });
  });

  it('throws an actionable error when the repo is not found', async () => {
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });
    await expect(
      useCase({ repo: 'owner/does-not-exist', pr_number: 1, agent: 'agent-1', wait_seconds: 1 }),
    ).rejects.toBeInstanceOf(McpToolError);
  });

  it('throws an actionable error when the PR number is not found', async () => {
    const useCase = makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: noopSleep,
    });
    await expect(
      useCase({ repo: 'owner/repo', pr_number: 999, agent: 'agent-1', wait_seconds: 1 }),
    ).rejects.toMatchObject({ code: 'pull_request_not_found' });
  });
});

describe('get_findings use-case', () => {
  it('reports run_not_found when the run_id is unknown to the in-memory cache', async () => {
    const api = new FakeDevDigestApi();
    const cache = new RunPrCache();
    const useCase = makeGetFindingsUseCase({ api, cache });
    await expect(useCase({ run_id: 'ghost' })).rejects.toMatchObject({ code: 'run_not_found' });
  });

  it('returns status running (not an error) while the run is in flight', async () => {
    const api = new FakeDevDigestApi();
    const cache = new RunPrCache();
    cache.remember('run-1', 'pr-1');
    api.runs['pr-1'] = [{ run_id: 'run-1', agent_id: 'a1', agent_name: 'A', status: 'running', error: null, ran_at: null }];
    const useCase = makeGetFindingsUseCase({ api, cache });
    const result = await useCase({ run_id: 'run-1' });
    expect(result.status).toBe('running');
    expect(result.findings).toEqual([]);
  });

  it('filters and caps findings by severity/limit once the run is done', async () => {
    const api = new FakeDevDigestApi();
    const cache = new RunPrCache();
    cache.remember('run-1', 'pr-1');
    api.runs['pr-1'] = [{ run_id: 'run-1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: null }];
    api.reviews['pr-1'] = [
      {
        run_id: 'run-1',
        verdict: 'comment',
        findings: [
          { id: 'f1', severity: 'CRITICAL', category: 'bug', title: 't1', file: 'a.ts', start_line: 1, end_line: 1, rationale: 'r', suggestion: null, confidence: 0.5 },
          { id: 'f2', severity: 'SUGGESTION', category: 'style', title: 't2', file: 'b.ts', start_line: 2, end_line: 2, rationale: 'r', suggestion: null, confidence: 0.5 },
        ],
      },
    ];
    const useCase = makeGetFindingsUseCase({ api, cache });
    const result = await useCase({ run_id: 'run-1', severity: 'CRITICAL' });
    expect(result.status).toBe('done');
    expect(result.total_findings).toBe(1);
    expect(result.findings[0]?.title).toBe('t1');
  });
});

describe('get_conventions use-case', () => {
  it('reports scanned:false with an empty list when the repo has never been scanned', async () => {
    const api = new FakeDevDigestApi();
    api.repos = [{ id: 'repo-1', owner: 'o', name: 'r', full_name: 'o/r' }];
    const useCase = makeGetConventionsUseCase({ api });
    const result = await useCase({ repo: 'o/r' });
    expect(result).toEqual({ repo: 'o/r', conventions: [], scanned: false });
  });

  it('returns only accepted conventions by default', async () => {
    const api = new FakeDevDigestApi();
    api.repos = [{ id: 'repo-1', owner: 'o', name: 'r', full_name: 'o/r' }];
    api.conventions['repo-1'] = {
      scanned_at: '2026-01-01T00:00:00.000Z',
      candidates: [
        { id: 'c1', category: 'style', rule: 'accepted rule', evidence_path: 'a.ts', confidence: 0.9, accepted: true },
        { id: 'c2', category: 'style', rule: 'pending rule', evidence_path: 'b.ts', confidence: 0.5, accepted: null },
      ],
    };
    const useCase = makeGetConventionsUseCase({ api });
    const result = await useCase({ repo: 'o/r' });
    expect(result.scanned).toBe(true);
    expect(result.conventions).toHaveLength(1);
    expect(result.conventions[0]?.rule).toBe('accepted rule');
  });
});

describe('get_blast_radius use-case', () => {
  it('is pure (no DevDigestApi dependency) and always returns the safe stub', () => {
    const useCase = makeGetBlastRadiusUseCase();
    const result = useCase({ repo: 'o/r', pr_number: 7 });
    expect(result.implemented).toBe(false);
    expect(result.affected).toEqual([]);
  });
});
