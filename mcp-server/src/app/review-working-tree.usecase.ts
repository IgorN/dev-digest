/**
 * Application ring — `devdigest review --mode working`'s one use-case.
 * Reuses the SAME agent config (fetched from the running DevDigest API,
 * `DevDigestApi` port — no separate/duplicated prompt) and the SAME engine
 * (`reviewer-core`'s `reviewPullRequest`, imported directly — pure, no I/O
 * of its own) that the product runs against GitHub PRs on the web UI. Only
 * the diff SOURCE differs: the local working tree instead of an imported PR.
 */
import { reviewPullRequest, type ReviewOutcome } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';
import type { GitClient } from '../ports/git.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import { McpToolError } from '../domain/errors.js';
import { parseUnifiedDiff } from '../domain/diff.js';

/** Default agent when the CLI caller doesn't pick one — the closest analog
 *  to "the reviewer" (singular) the task describes; the seeded starter has
 *  no agent literally named "Structured Reviewer" (that phrase names the
 *  engine's structured-output architecture, not one specific agent row). */
export const DEFAULT_AGENT_NAME = 'General Reviewer';

export interface ReviewWorkingTreeInput {
  /** Directory to diff — the repo the user actually invoked the CLI in. */
  cwd: string;
  agentName?: string;
}

export type ReviewWorkingTreeOutput =
  | { noChanges: true }
  | { noChanges: false; outcome: ReviewOutcome; agentName: string; model: string; filesChanged: number };

export function makeReviewWorkingTreeUseCase(deps: {
  git: GitClient;
  api: DevDigestApi;
  buildLlm: () => LLMProvider;
}) {
  return async function reviewWorkingTree(
    input: ReviewWorkingTreeInput,
  ): Promise<ReviewWorkingTreeOutput> {
    const rawDiff = await deps.git.workingTreeDiff(input.cwd);
    if (!rawDiff.trim()) return { noChanges: true };

    const diff = parseUnifiedDiff(rawDiff);

    const wantedName = input.agentName ?? DEFAULT_AGENT_NAME;
    const agents = await deps.api.listAgents({ enabledOnly: true });
    const agent = agents.find((a) => a.name.toLowerCase() === wantedName.toLowerCase());
    if (!agent) {
      throw new McpToolError(
        'agent_not_found',
        `Agent "${wantedName}" not found (or disabled). Available agents: ${
          agents.map((a) => a.name).join(', ') || '(none)'
        }.`,
      );
    }

    const llm = deps.buildLlm();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.system_prompt,
      model: agent.model,
      diff,
      llm,
    });

    return {
      noChanges: false,
      outcome,
      agentName: agent.name,
      model: agent.model,
      filesChanged: diff.files.length,
    };
  };
}
