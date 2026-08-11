/**
 * Why + Risk Brief — the feature's ONE synthesis call (application ring).
 *
 * Turns the `ChatMessage[]` assembled by `assemble.ts`'s `buildBriefMessages`
 * (T3) into the structured `{ what, why, risk_level, risks, review_focus }`
 * brief via a SINGLE `completeStructured` call — this is AC-1's "exactly one
 * new model call." `GeneratedBrief` is a LOCAL schema, not exported to
 * `@devdigest/shared` — mirrors `blast/summarize.ts`'s local `SummaryOutput`
 * pattern: it borrows `RiskSeverity`/`Risk`/`ReviewFocusItem` straight from
 * the shared contract rather than declaring parallel "Generated…" element
 * types, since `Risk.kind` is already a loose `z.string()` with nothing to
 * narrow further for a model-output variant.
 *
 * MUST call `completeStructured`, never `.complete()` — `OpenRouterProvider`
 * only implements `completeStructured`; `.complete()` is an intentional
 * always-throwing stub that every mocked test still passes, only failing
 * live (reviewer-core/src/llm/openrouter.ts, server/INSIGHTS.md 2026-07-15).
 * Mirrors `intent/extract.ts`'s `classifyIntent` call shape exactly,
 * including the optional `sessionId` spread.
 *
 * No additional injection-guard text is added here beyond `assemble.ts`'s
 * (T3) `wrapUntrusted` wrapping of every untrusted span already folded into
 * `messages` — this call is structured-output-only with no tools, the same
 * accepted trust profile as `intent/extract.ts` and `blast/summarize.ts`
 * (both already security-reviewed as Low/inert for this exact posture).
 */
import { z } from 'zod';
import type { ChatMessage, LLMProvider } from '@devdigest/shared';
import { Risk, ReviewFocusItem, RiskSeverity } from '@devdigest/shared';

const GeneratedBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});

export interface SynthesizeResult {
  data: z.infer<typeof GeneratedBrief>;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export async function synthesizeBrief(
  llm: LLMProvider,
  model: string,
  messages: ChatMessage[],
  sessionId?: string,
): Promise<SynthesizeResult> {
  const res = await llm.completeStructured({
    model,
    schema: GeneratedBrief,
    schemaName: 'WhyRiskBrief',
    messages,
    temperature: 0,
    ...(sessionId ? { sessionId } : {}),
  });
  return {
    data: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
