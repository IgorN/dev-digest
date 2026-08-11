/**
 * Onboarding narrative — the feature's ONE LLM call (onion application ring).
 *
 * A single `completeStructured` call (never `complete()` — the default
 * `openrouter` provider stubs `complete()` to throw; see server INSIGHTS) that
 * ENRICHES the deterministic skeleton from `skeleton.ts`. The skeleton is the
 * base and the fallback: its bodies/links are used whenever the model omits or
 * violates a section, so an unusable model result degrades to a valid tour
 * (AC-12) instead of throwing.
 *
 * All untrusted repo facts (paths, symbol names, script strings, stack labels)
 * are wrapped in `<untrusted>…</untrusted>` before they reach the prompt so the
 * model treats them as DATA, not instructions.
 *
 * Post-validation enforces the security/grounding contract regardless of what
 * the model returns: exactly the 5 kinds in fixed order (AC-7), a `diagram`
 * only on `architecture` and `null` everywhere else (AC-8), and every
 * `OnboardingLink.path` dropped unless it is in the gathered-facts allow-list
 * (AC-9). Non-determinism at `temperature:0` is expected (server INSIGHTS) —
 * callers/tests must assert on structure, not exact prose.
 */
import { z } from 'zod';
import type { ChatMessage, LLMProvider, Onboarding, OnboardingLink, OnboardingSection } from '@devdigest/shared';
import { renderPrompt } from '../../platform/prompts.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { filterLinksToAllowed } from './helpers.js';
import { buildSkeleton, ONBOARDING_KINDS, type OnboardingKind } from './skeleton.js';
import { RUN_LOCALLY_COMMAND_CAP } from './constants.js';
import type { FactsBundle } from './facts.js';

/** Bounds the repo-map excerpt fed to the model so a huge tree can't blow the token budget. */
const MAX_REPO_MAP_CHARS = 4000;

/** The model's per-section output. `kind`/order/diagram/links are all re-validated post-call. */
const GeneratedLink = z.object({ label: z.string(), path: z.string() });
const GeneratedSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullish(),
  commands: z.array(z.string()).nullish(),
  links: z.array(GeneratedLink).optional(),
});
const GeneratedOnboarding = z.object({ sections: z.array(GeneratedSection) });
type GeneratedOnboarding = z.infer<typeof GeneratedOnboarding>;

/**
 * The five kinds, described for the prompt's `{{sections}}` placeholder. The
 * `kind` identifiers here MUST match `ONBOARDING_KINDS` (post-validation keys
 * the model's output back to them).
 */
const SECTIONS_INSTRUCTION = [
  '1. `architecture` — a concise overview of how the system is structured, WITH one Mermaid `diagram`.',
  '2. `critical-paths` — the most important execution / dependency paths through the code.',
  '3. `run-locally` — how to install, configure, and run the project locally, WITH the runnable shell commands in `commands`.',
  '4. `reading-path` — a guided order of files to read first (highest-ranked, most central first).',
  '5. `first-tasks` — 3–5 good first changes, each grounded in a real file from the facts.',
].join('\n');

export interface GenerateResult {
  onboarding: Onboarding;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Run the single narrative call and merge its output onto the skeleton. Builds
 * the skeleton first (so a caller always holds a valid tour), issues exactly
 * one `completeStructured`, then post-validates + merges. Returns token/cost
 * for the service's one log line (AC-15).
 */
export async function generateOnboarding(
  llm: LLMProvider,
  model: string,
  facts: FactsBundle,
  options?: { language?: string; sessionId?: string },
): Promise<GenerateResult> {
  const language = options?.language ?? 'English';
  const skeleton = buildSkeleton(facts);

  const system = await renderPrompt('onboarding.system.md', { sections: SECTIONS_INSTRUCTION, language });
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: wrapUntrusted('repo-facts', buildFactsBlock(facts)) },
  ];

  const res = await llm.completeStructured<GeneratedOnboarding>({
    model,
    schema: GeneratedOnboarding,
    schemaName: 'Onboarding',
    messages,
    temperature: 0,
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
  });

  const onboarding: Onboarding = {
    ...skeleton,
    sections: mergeSections(skeleton.sections, res.data.sections, facts),
  };

  return {
    onboarding,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}

/**
 * Merge the model's sections onto the skeleton, normalizing to exactly the 5
 * kinds in fixed order (AC-7). Per section: keep the model's body/title when
 * non-empty (else the skeleton's); allow a `diagram` ONLY on `architecture`,
 * `null` everywhere else (AC-8); accept only model links whose `path` is in the
 * facts allow-list, falling back to the skeleton's links when none survive (AC-9).
 */
function mergeSections(
  skeleton: OnboardingSection[],
  modelSections: GeneratedOnboarding['sections'],
  facts: FactsBundle,
): OnboardingSection[] {
  const skeletonByKind = new Map(skeleton.map((s) => [s.kind, s]));
  const modelByKind = new Map(modelSections.map((s) => [s.kind, s]));

  return ONBOARDING_KINDS.map((kind): OnboardingSection => {
    // The skeleton always has every kind, so `base` is guaranteed present.
    const base = skeletonByKind.get(kind)!;
    const model = modelByKind.get(kind);
    if (!model) return base;

    const title = model.title.trim() ? model.title.trim() : base.title;
    const diagram = kind === 'architecture' ? normalizeDiagram(model.diagram) : null;
    const commands = kind === 'run-locally' ? mergeCommands(model.commands, base.commands) : null;
    const links = mergeLinks(model.links, base.links, facts);

    const rawBody = model.body.trim() ? model.body.trim() : base.body;
    // Once `commands` carries the commands structurally, the body must NOT also
    // repeat them as a fenced block — the client renders both, so the user would
    // see the commands twice (copyable rows AND the rendered block). Enforced
    // here rather than in the prompt: the cheap onboarding model already proved
    // it ignores prose formatting rules. Falls back to the skeleton body if
    // stripping empties it (every section keeps a non-empty body).
    const body =
      commands && commands.length > 0 ? stripFencedBlocks(rawBody) || base.body : rawBody;

    return { kind, title, body, diagram, commands, links };
  });
}

/** A diagram is a non-empty trimmed string or `null` — never `''` (AC-8). */
function normalizeDiagram(diagram: string | null | undefined): string | null {
  const trimmed = diagram?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Drop block-level fenced code blocks, preserving the surrounding narration.
 * Only used on `run-locally` once `commands` is populated (see `mergeSections`).
 * Inline code spans are deliberately untouched — narration legitimately cites
 * file names and flags inline.
 */
function stripFencedBlocks(body: string): string {
  return body
    .replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Runnable commands survive ONLY on `run-locally` (mirrors the diagram rule).
 * Entries are trimmed, empties dropped, and the list capped; when the model
 * returns nothing usable we fall back to the skeleton's deterministic sequence
 * — so a weak model can only improve the commands, never erase them.
 */
function mergeCommands(
  modelCommands: string[] | null | undefined,
  skeletonCommands: string[] | null | undefined,
): string[] | null {
  const cleaned = (modelCommands ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length > 0) return cleaned.slice(0, RUN_LOCALLY_COMMAND_CAP);
  const fallback = skeletonCommands ?? [];
  return fallback.length > 0 ? fallback.slice(0, RUN_LOCALLY_COMMAND_CAP) : null;
}

/** Drop links whose path is not in the allow-list (AC-9); fall back to skeleton links. */
function mergeLinks(
  modelLinks: OnboardingLink[] | undefined,
  skeletonLinks: OnboardingLink[],
  facts: FactsBundle,
): OnboardingLink[] {
  const allowed = filterLinksToAllowed(modelLinks ?? [], facts.allowedPaths).slice(0, 4);
  return allowed.length > 0 ? allowed : skeletonLinks;
}

/**
 * Assemble the untrusted facts block for the single call. Only real, gathered
 * facts appear here (stack, scripts, ranked reading path, critical paths, top
 * symbols, a bounded repo-map excerpt) plus the explicit allow-list of legal
 * link paths — everything the model is permitted to cite, and nothing else.
 */
function buildFactsBlock(facts: FactsBundle): string {
  const lines: string[] = [];

  lines.push(`Index state: ${facts.indexState.status}${facts.indexState.degraded ? ' (degraded)' : ''}`);
  if (facts.indexState.reason) lines.push(`Index note: ${facts.indexState.reason}`);
  lines.push(`Files indexed: ${facts.indexState.filesIndexed}`);

  lines.push('', 'Stack:');
  lines.push(`- Package name: ${facts.stack.packageName ?? '(none)'}`);
  lines.push(`- Frameworks: ${facts.stack.frameworks.join(', ') || '(none detected)'}`);
  if (facts.stack.dependencies.length > 0) lines.push(`- Dependencies: ${facts.stack.dependencies.join(', ')}`);

  lines.push('', 'Package scripts:');
  if (facts.runLocally.scripts.length === 0) lines.push('- (none)');
  for (const s of facts.runLocally.scripts) lines.push(`- ${s.name}: ${s.command}`);
  lines.push(`- .env.example present: ${facts.runLocally.hasEnvExample}`);
  lines.push(`- docker-compose present: ${facts.runLocally.hasDockerCompose}`);

  lines.push('', 'Reading path (descending file rank — most central first):');
  if (facts.readingPath.length === 0) lines.push('- (none ranked)');
  for (const entry of facts.readingPath) lines.push(`- ${entry.path} (rank ${entry.rank.toFixed(3)})`);

  lines.push('', 'Critical dependency paths:');
  if (facts.criticalPaths.length === 0) lines.push('- (none)');
  for (const chain of facts.criticalPaths) lines.push(`- ${chain.join(' -> ')}`);

  lines.push('', 'Top symbols (for first-tasks grounding):');
  if (facts.topSymbols.length === 0) lines.push('- (none)');
  for (const sym of facts.topSymbols) lines.push(`- ${sym.kind} ${sym.name} (${sym.file})`);

  if (facts.repoMap.trim()) {
    lines.push('', 'Repo map skeleton:', facts.repoMap.slice(0, MAX_REPO_MAP_CHARS));
  }

  lines.push('', 'Allowed link paths (use ONLY these as OnboardingLink.path — any other path is rejected):');
  const allowed = [...facts.allowedPaths];
  if (allowed.length === 0) lines.push('- (none)');
  for (const p of allowed) lines.push(`- ${p}`);

  return lines.join('\n');
}
