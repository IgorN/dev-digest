import type { ChatMessage, IssueMeta, LLMProvider, PrDetail, UnifiedDiff } from '@devdigest/shared';
import { Intent } from '@devdigest/shared';
import { formatFileHunkLines } from './hunk-format.js';

/**
 * The Intent classifier — a cheap, structured "why was this PR opened" pass
 * run BEFORE the main review. Given title/body/linked-issue/file-list-and-
 * hunk-headers (never diff bodies), it derives a summary + explicit
 * in-scope/out-of-scope lists (the existing `Intent` schema from
 * `@devdigest/shared`'s `brief.ts` — imported, not redefined).
 *
 * Design decision A (graceful degradation): `buildUserMessage` builds the same
 * message shape regardless of which fields are present. An empty/null body and
 * an absent linked issue never throw, skip, or early-return — the system
 * prompt instructs the model to do its best-effort inference from title + file
 * list + hunk headers alone in that case.
 *
 * Design decision B (spec/plan detection, scope boundary): inline plan/spec
 * text in the PR body or linked-issue body is captured "for free" because the
 * full raw body text is passed through — NOT truncated the way the main
 * review's `assemblePrompt` truncates `prDescription` at 4000 chars (that cap
 * exists for a different prompt with different token-budget math). This
 * classifier instead caps each of {PR body, issue body} independently at
 * MAX_BODY_CHARS (documented below) — generous enough to preserve most inline
 * specs while still bounding token cost on pathological inputs. An EXTERNAL
 * link/reference (Notion/Jira/Confluence/etc.) in the body is visible to the
 * model as plain text only — fetching/resolving it is explicitly OUT OF SCOPE
 * for this lesson: no new HTTP client, no new adapter, no new secret.
 */

/**
 * Generous-but-bounded cap per body (PR body, issue body) — deliberately NOT
 * the main review's unrelated `MAX_PR_DESCRIPTION_CHARS` (4000), which exists
 * for a different prompt with different token-budget math. 12,000 chars is
 * large enough to carry a full inline spec/plan while still bounding a single
 * classifier call's cost on a pathological (e.g. copy-pasted log dump) body.
 */
export const MAX_BODY_CHARS = 12_000;

const SYSTEM_PROMPT = `You derive the INTENT and SCOPE of a pull request before a full code review runs.

You are given the PR's title, description, an optional linked issue (title + body), the list of changed files, and synthesized hunk-header lines (file boundaries only — no diff content). You are never given the actual added/removed code.

Your job: infer WHY this PR was opened and WHAT it is meant to change, then state that scope explicitly so a reviewer can focus on it.

Rules for your output:
- Respond in ENGLISH only, regardless of the language of the input text.
- "intent": one or two sentences — what this PR does and why, in plain language.
- "in_scope": a short list of the specific areas/behaviors this PR is meant to touch (e.g. "adds rate limiting to /api/login", "refactors the retry helper"). Base this on the title, body, linked issue, and the changed file paths/hunk locations.
- "out_of_scope": a short list of adjacent areas that this PR explicitly should NOT be judged against — things a reviewer might be tempted to flag but that are pre-existing/unrelated to this PR's purpose (e.g. "pre-existing test coverage gaps", "unrelated files in the same directory").
- If the PR body is empty and there is no linked issue, do your best-effort inference from the title and the changed file paths/hunk locations alone. Never refuse, never return a placeholder like "cannot infer" — always produce a valid best-effort intent.
- Do not invent specifics that aren't supported by the given title/body/issue/file list — when uncertain, keep "in_scope"/"out_of_scope" entries general rather than fabricating detail.
- An external link/reference in the body (e.g. a Notion/Jira/Confluence URL) may inform your read of intent as plain text context, but do not claim to know its contents — you were not given them.`;

/** Build the classifier's user message. Never throws; degrades gracefully
 *  when body/linked-issue are absent (design decision A). */
export function buildUserMessage(pr: PrDetail, diff: UnifiedDiff): string {
  const lines: string[] = [];

  lines.push(`Title: ${pr.title}`);

  const body = pr.body?.trim();
  lines.push(body ? `Body:\n${body.slice(0, MAX_BODY_CHARS)}` : 'Body: (empty)');

  lines.push(formatLinkedIssue(pr.linked_issue));

  const files = diff.files.map((f) => f.path);
  lines.push(files.length > 0 ? `Changed files:\n${files.map((f) => `- ${f}`).join('\n')}` : 'Changed files: (none)');

  const hunkLines = formatFileHunkLines(diff);
  lines.push(
    hunkLines.length > 0
      ? `Hunk boundaries (file: @@ headers, no content):\n${hunkLines.map((l) => `- ${l}`).join('\n')}`
      : 'Hunk boundaries: (none)',
  );

  return lines.join('\n\n');
}

function formatLinkedIssue(issue: IssueMeta | null | undefined): string {
  if (!issue) return 'Linked issue: (none)';
  const body = issue.body?.trim();
  return [
    `Linked issue #${issue.number}: ${issue.title}`,
    body ? `Linked issue body:\n${body.slice(0, MAX_BODY_CHARS)}` : 'Linked issue body: (empty)',
  ].join('\n');
}

export interface ClassifyResult {
  intent: Intent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Run the structured classification. One `completeStructured` call, the
 * existing `Intent` schema (never redefined), `temperature: 0` — note that per
 * `server/INSIGHTS.md`, `completeStructured` is non-deterministic even at
 * temperature 0, so a recompute producing slightly different phrasing each run
 * is expected, not a bug.
 */
export async function classifyIntent(
  llm: LLMProvider,
  model: string,
  pr: PrDetail,
  diff: UnifiedDiff,
  sessionId?: string,
): Promise<ClassifyResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(pr, diff) },
  ];
  const res = await llm.completeStructured<Intent>({
    model,
    schema: Intent,
    schemaName: 'Intent',
    messages,
    temperature: 0,
    ...(sessionId ? { sessionId } : {}),
  });
  return {
    intent: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
