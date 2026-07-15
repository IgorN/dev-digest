/**
 * The feature's ONLY LLM call: one cheap, structured completion that turns
 * the already-computed map into a one-paragraph explanation —
 * `BlastRadius.summary`. Uses `completeStructured` (a trivial one-field
 * schema), NOT the generic `complete()` — `OpenRouterProvider` (the default
 * provider for this feature) only implements `completeStructured`;
 * `complete()` is an intentional stub there that always throws
 * (reviewer-core/src/llm/openrouter.ts). Mirrors intent/extract.ts's call
 * shape (container.llm(provider) → single completeStructured call).
 */
import { z } from 'zod';
import type { ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import type { ChatMessage, LLMProvider } from '@devdigest/shared';
import { SUMMARY_SYSTEM_PROMPT } from './constants.js';

const SummaryOutput = z.object({ summary: z.string() });

function buildUserMessage(changedSymbols: ChangedSymbol[], downstream: DownstreamImpact[]): string {
  const lines: string[] = [`Changed symbols (${changedSymbols.length}):`];
  for (const s of changedSymbols) lines.push(`- ${s.kind} ${s.name} (${s.file})`);
  lines.push('', 'Downstream impact:');
  if (downstream.length === 0) lines.push('(none found)');
  for (const d of downstream) {
    lines.push(
      `- ${d.symbol}: ${d.callers.length} caller(s); endpoints: ${
        d.endpoints_affected.join(', ') || 'none'
      }; crons: ${d.crons_affected.join(', ') || 'none'}`,
    );
  }
  return lines.join('\n');
}

export interface SummarizeResult {
  summary: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export async function summarizeBlastRadius(
  llm: LLMProvider,
  model: string,
  changedSymbols: ChangedSymbol[],
  downstream: DownstreamImpact[],
): Promise<SummarizeResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(changedSymbols, downstream) },
  ];
  const res = await llm.completeStructured({
    model,
    schema: SummaryOutput,
    schemaName: 'BlastRadiusSummary',
    messages,
    temperature: 0,
    maxTokens: 220,
  });
  return {
    summary: res.data.summary.trim(),
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
