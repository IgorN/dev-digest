import { z } from 'zod';
import type { ChatMessage, LLMProvider } from '@devdigest/shared';
import type { RawCandidate } from './verify.js';

/**
 * The cheap-model pass: given a handful of real repo files, propose the house
 * conventions the code ACTUALLY follows. The model only proposes — every
 * candidate is verified against the real files downstream (verify.ts), so the
 * prompt's job is recall + verbatim evidence, not trust.
 */

export const CONVENTION_CATEGORIES = [
  'naming',
  'error-handling',
  'structure',
  'async',
  'imports',
  'data-access',
  'api',
  'testing',
  'other',
] as const;

const RawCandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      category: z.enum(CONVENTION_CATEGORIES),
      rule: z.string().min(1),
      evidence_path: z.string().min(1),
      evidence_anchor: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/** Cap each file so a few large files can't blow the token budget. */
const MAX_FILE_CHARS = 4000;

const SYSTEM_PROMPT = `You extract the house coding CONVENTIONS a repository actually follows, from real source files.

You are given several files (path + content). Identify recurring, project-specific rules a reviewer should enforce — e.g. "public handlers return Result<T, ApiError>", "async/await, never .then() chains", "Redis access goes through the src/lib/redis.ts singleton".

Rules for your output:
- Respond in ENGLISH only. Every "rule" must be written in clear English.
- Each candidate's "rule" must be DIRECTIVE and specific to THIS codebase (not generic advice). Phrase it as an enforceable rule.
- "category" is one of: ${CONVENTION_CATEGORIES.join(', ')}.
- "evidence_path" MUST be exactly one of the provided file paths.
- "evidence_anchor" MUST be a SHORT, DISTINCTIVE string copied EXACTLY (character-for-character) from that file that proves the rule — a rule name, identifier, config key, or function signature (e.g. "@stylistic/brace-style", "consistent-type-imports", "createOrder"). 4-80 chars. It is checked against the file and the candidate is dropped if the anchor is not found, so copy it exactly. Do NOT use a common word like "error", "return", "const", or "import" as the anchor.
- "confidence" in [0,1]: how strongly the sampled code supports the rule.
- Propose only DISTINCT, well-evidenced conventions (typically 3-8). Do not pad. If a rule has no exact anchor in the files, omit it.`;

function buildUserMessage(files: Array<{ path: string; content: string }>): string {
  const blocks = files.map((f) => {
    const body = f.content.length > MAX_FILE_CHARS ? f.content.slice(0, MAX_FILE_CHARS) : f.content;
    return `--- FILE: ${f.path} ---\n${body}`;
  });
  return `Analyze these files and extract the repository's coding conventions.\n\n${blocks.join('\n\n')}`;
}

export interface ExtractResult {
  candidates: RawCandidate[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/** Run the structured extraction. `files` are the sampled (path, content) pairs. */
export async function extractCandidates(
  llm: LLMProvider,
  model: string,
  files: Array<{ path: string; content: string }>,
  sessionId?: string,
): Promise<ExtractResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(files) },
  ];
  const res = await llm.completeStructured({
    model,
    schema: RawCandidatesSchema,
    schemaName: 'RepoConventions',
    messages,
    temperature: 0,
    ...(sessionId ? { sessionId } : {}),
  });
  return {
    candidates: res.data.candidates,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
