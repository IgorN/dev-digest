import type { BlastRadius, ChatMessage, Intent, IssueMeta, SmartDiffRole } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { truncateToBytes } from '../context/helpers.js';
import type { SeverityCounts } from '../pulls/status.js';
import {
  BLAST_MAX_CHARS,
  BRIEF_SYSTEM_PROMPT,
  INTENT_MAX_CHARS,
  LINKED_ISSUE_MAX_CHARS,
  SMART_DIFF_MAX_CHARS,
} from './constants.js';

/**
 * Why + Risk Brief — pure prompt assembly (onion domain ring; zero I/O).
 *
 * Turns the already-computed inputs into the `ChatMessage[]` for the
 * feature's ONE synthesis call — the spec's original five (Intent, Blast
 * Radius, Smart Diff counts, linked issue, Context-Folder docs) plus a
 * sixth added post-verification (AD-5, `docs/plans/why-risk-brief.md`):
 * `findingsSummary`, a deterministic severity rollup from the project's own
 * line-level reviewer. Mirrors `reviewer-core/src/prompt.ts`'s
 * "omitted entirely when undefined" convention (its `## Intent` section):
 * each section below is rendered only when its source input is present,
 * never a stub/placeholder heading for a missing one (AC-8, AC-9, AC-10).
 *
 * Deliberately takes NO diff-body input: `BriefInputs` has no `PrFile[]` /
 * patch field at all, so this function can never read or reference
 * `PrFile.patch` or any diff hunk — AC-6 ("never include full file-diff
 * bodies") is enforced by construction, not by a runtime check. Callers
 * needing a grounding set of real file paths use `helpers.ts`'s
 * `buildGroundingSet` instead, which takes the PR's files directly.
 *
 * Every per-input cap here is a NAMED constant from `constants.ts` so the
 * AC-7 8,000-token budget is provably under budget by construction — see
 * that file's header for the worst-case sum.
 */

export interface BriefInputs {
  prTitle: string;
  intent: Intent | undefined;
  blast: BlastRadius | undefined;
  smartDiffCounts: { role: SmartDiffRole; count: number }[];
  linkedIssue: IssueMeta | null;
  /**
   * Already selected (via `helpers.ts`'s `selectContextDocs`) AND already
   * capped at `CONTEXT_DOC_MAX_CHARS` per doc by the caller (a later
   * service-layer task) — this function does not re-truncate `content`, it
   * only wraps it as untrusted.
   */
  contextDocs: { path: string; content: string }[];
  /**
   * Deterministic severity rollup from the project's OWN existing
   * line-level reviewer (AD-5) — CRITICAL/WARNING/SUGGESTION counts across
   * every agent's latest, non-dismissed findings for this PR. Always
   * present (never undefined): a PR that has never been reviewed rolls up
   * to all-zero counts, which is itself meaningful signal (not a missing
   * input), so — unlike every other section below — it renders
   * unconditionally.
   */
  findingsSummary: SeverityCounts;
}

/**
 * Build the system + user messages for the one `completeStructured` call.
 * Every span drawn from PR-controlled or third-party text — the PR title,
 * `intent.intent`, the blast summary, the linked issue's title/body, and
 * each context doc's content — is untrusted and is wrapped via
 * `wrapUntrusted` before it enters the user message. The smart-diff counts
 * line is deterministic, server-computed text (counts only, never a file
 * list or diff body), so it is not wrapped.
 */
export function buildBriefMessages(inputs: BriefInputs): ChatMessage[] {
  const sections: string[] = [`PR title:\n${wrapUntrusted('pr-title', inputs.prTitle)}`];

  const fc = inputs.findingsSummary;
  sections.push(
    `## Existing review findings\n${fc.critical} critical, ${fc.warning} warning, ` +
      `${fc.suggestion} suggestion finding(s) already found by this project's own line-level ` +
      'reviewer (already-dismissed findings excluded).',
  );

  if (inputs.intent) {
    const { text } = truncateToBytes(inputs.intent.intent, INTENT_MAX_CHARS);
    sections.push(`## Intent\n${wrapUntrusted('intent', text)}`);
  }

  if (inputs.blast) {
    const { text } = truncateToBytes(inputs.blast.summary, BLAST_MAX_CHARS);
    sections.push(`## Blast radius\n${wrapUntrusted('blast-summary', text)}`);
  }

  if (inputs.smartDiffCounts.length > 0) {
    const line = inputs.smartDiffCounts.map((c) => `${c.count} ${c.role}`).join(', ');
    const { text } = truncateToBytes(line, SMART_DIFF_MAX_CHARS);
    sections.push(`## Smart diff\nFile counts by role: ${text}`);
  }

  if (inputs.linkedIssue) {
    const body = inputs.linkedIssue.body ?? '';
    const combined = body.length > 0 ? `${inputs.linkedIssue.title}\n\n${body}` : inputs.linkedIssue.title;
    const { text } = truncateToBytes(combined, LINKED_ISSUE_MAX_CHARS);
    sections.push(`## Linked issue\n${wrapUntrusted('linked-issue', text)}`);
  }

  if (inputs.contextDocs.length > 0) {
    const docsBlock = inputs.contextDocs
      .map((doc) => wrapUntrusted(`context-doc:${doc.path}`, doc.content))
      .join('\n\n');
    sections.push(`## Context docs\n${docsBlock}`);
  }

  return [
    { role: 'system', content: BRIEF_SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n\n') },
  ];
}
