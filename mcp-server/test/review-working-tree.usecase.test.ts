import { describe, it, expect } from 'vitest';
import { makeReviewWorkingTreeUseCase, DEFAULT_AGENT_NAME } from '../src/app/review-working-tree.usecase.js';
import { McpToolError } from '../src/domain/errors.js';
import { FakeDevDigestApi, FakeGitClient, FakeLLMProvider } from './fakes.js';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-old
+new
`;

const REVIEW_FIXTURE = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 92,
  findings: [],
};

function setup() {
  const git = new FakeGitClient();
  const api = new FakeDevDigestApi();
  api.agents = [
    {
      id: 'a1',
      name: 'General Reviewer',
      description: 'd',
      provider: 'openrouter',
      model: 'openrouter/deepseek-v4-flash',
      enabled: true,
      system_prompt: 'You are a general reviewer.',
    },
    {
      id: 'a2',
      name: 'Security Reviewer',
      description: 'd',
      provider: 'openrouter',
      model: 'openrouter/deepseek-v4-flash',
      enabled: true,
      system_prompt: 'You are a security reviewer.',
    },
  ];
  const llm = new FakeLLMProvider(REVIEW_FIXTURE);
  const reviewWorkingTree = makeReviewWorkingTreeUseCase({ git, api, buildLlm: () => llm });
  return { git, api, llm, reviewWorkingTree };
}

describe('review-working-tree use case', () => {
  it('returns noChanges when the working tree diff is empty, without calling the API or LLM', async () => {
    const { api, llm, reviewWorkingTree } = setup();
    api.agents = []; // would fail loudly if the use case tried to look up an agent anyway
    const result = await reviewWorkingTree({ cwd: '/repo' });
    expect(result).toEqual({ noChanges: true });
    expect(llm.calls).toHaveLength(0);
  });

  it('reviews a non-empty diff via the default agent (General Reviewer) and calls the REAL reviewPullRequest engine', async () => {
    const { git, llm, reviewWorkingTree } = setup();
    git.diffByCwd['/repo'] = SAMPLE_DIFF;

    const result = await reviewWorkingTree({ cwd: '/repo' });

    expect(result.noChanges).toBe(false);
    if (result.noChanges) throw new Error('unreachable');
    expect(result.agentName).toBe(DEFAULT_AGENT_NAME);
    expect(result.model).toBe('openrouter/deepseek-v4-flash');
    expect(result.filesChanged).toBe(1);
    expect(result.outcome.review.verdict).toBe('approve');

    // Proves the SAME agent config was handed to the SAME engine: exactly
    // one completeStructured call, with this agent's real system prompt.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.messages.some((m) => m.content.includes('You are a general reviewer.'))).toBe(true);
  });

  it('picks a different agent by name when given one', async () => {
    const { git, llm, reviewWorkingTree } = setup();
    git.diffByCwd['/repo'] = SAMPLE_DIFF;

    const result = await reviewWorkingTree({ cwd: '/repo', agentName: 'Security Reviewer' });

    expect(result.noChanges).toBe(false);
    if (result.noChanges) throw new Error('unreachable');
    expect(result.agentName).toBe('Security Reviewer');
    expect(llm.calls[0]?.messages.some((m) => m.content.includes('You are a security reviewer.'))).toBe(true);
  });

  it('throws a McpToolError (agent_not_found) listing available agents when the requested one is missing', async () => {
    const { git, reviewWorkingTree } = setup();
    git.diffByCwd['/repo'] = SAMPLE_DIFF;

    await expect(reviewWorkingTree({ cwd: '/repo', agentName: 'Nonexistent Reviewer' })).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(McpToolError);
        expect((err as McpToolError).code).toBe('agent_not_found');
        expect((err as McpToolError).message).toContain('General Reviewer');
        expect((err as McpToolError).message).toContain('Security Reviewer');
        return true;
      },
    );
  });
});
