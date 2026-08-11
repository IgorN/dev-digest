import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import type { RunnerFile } from './runner-bundle.js';

/**
 * DOMAIN CORE types for the ci module's pure generation path. Deliberately NOT
 * Drizzle row types: `generation.ts` / `manifest.ts` / `workflow.ts` must be
 * exercisable with plain objects, no database and no filesystem.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

/** The four things a "tuned agent" is: model + system prompt + skills + settings. */
export interface CiAgentInput {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

/** A skill linked to the agent, in link order. Disabled ones are excluded here. */
export interface CiSkillInput {
  name: string;
  body: string;
  enabled: boolean;
}

export interface BuildFileSetInput {
  agent: CiAgentInput;
  /** Linked skills IN LINK ORDER (enabled and disabled — filtering is our job). */
  skills: CiSkillInput[];
  /** Every file the runner build emitted, read verbatim by `runner-bundle.ts`. */
  runnerFiles: RunnerFile[];
  /** PINNED at first install (AC-3) — never re-derived from the agent's name. */
  manifestPath: string;
  triggers: string[];
  postAs: PostAs;
  workflowVersion: number;
  /**
   * The user's hand-edited workflow from the wizard's Preview step. Absent ⇒
   * generate it (AC-70). Never parsed or executed by the server — it is
   * committed to the user's own repository under their own review.
   */
  workflowOverride?: string | null;
}

export type { RunnerFile };
