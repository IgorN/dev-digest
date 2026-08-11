import { describe, it, expect } from 'vitest';
import type {
  ChatMessage,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { generateOnboarding } from './generate.js';
import { buildSkeleton, ONBOARDING_KINDS } from './skeleton.js';
import { RUN_LOCALLY_COMMAND_CAP } from './constants.js';
import type { FactsBundle } from './facts.js';

/**
 * T4 — the single LLM call + skeleton + post-validation. Proves, with a STUB
 * `LLMProvider` (never a real network call): (i) exactly ONE `completeStructured`
 * invocation, (ii) sections normalized to the 5 kinds in fixed order (AC-7),
 * (iii) a diagram the model puts on a non-`architecture` section is nulled
 * (AC-8), (iv) a link whose path is not in the facts allow-list is dropped
 * (AC-9), and (v) the skeleton builds all 5 kinds from a degraded bundle (AC-11).
 * `completeStructured` is non-deterministic even at temperature 0 (server
 * INSIGHTS), so assertions are on STRUCTURE/COUNTS, never exact prose.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullFacts(overrides: Partial<FactsBundle> = {}): FactsBundle {
  return {
    repoId: 'r1',
    hasClone: true,
    indexState: { status: 'full', degraded: false, reason: null, filesIndexed: 42 },
    stack: { packageName: 'demo', frameworks: ['Fastify'], dependencies: ['fastify'], devDependencies: [] },
    repoMap: 'src/\n  app.ts\n  index.ts',
    criticalPaths: [['src/index.ts', 'src/app.ts']],
    runLocally: {
      scripts: [{ name: 'dev', command: 'tsx watch' }],
      hasEnvExample: true,
      hasDockerCompose: false,
      hasSignals: true,
      files: ['.env.example'],
    },
    readingPath: [
      { path: 'src/app.ts', rank: 0.9 },
      { path: 'src/index.ts', rank: 0.8 },
    ],
    topSymbols: [{ file: 'src/app.ts', name: 'build', kind: 'function' }],
    allowedPaths: new Set(['src/app.ts', 'src/index.ts', '.env.example', 'package.json']),
    ...overrides,
  };
}

function degradedFacts(): FactsBundle {
  return {
    repoId: 'r2',
    hasClone: false,
    indexState: { status: 'degraded', degraded: true, reason: 'no local clone', filesIndexed: 0 },
    stack: { packageName: null, frameworks: [], dependencies: [], devDependencies: [] },
    repoMap: '',
    criticalPaths: [],
    runLocally: { scripts: [], hasEnvExample: false, hasDockerCompose: false, hasSignals: false, files: [] },
    readingPath: [],
    topSymbols: [],
    allowedPaths: new Set(),
  };
}

/**
 * A stub provider whose `completeStructured` returns a canned payload and counts
 * its calls. `complete()` throws — proving the module only ever uses
 * `completeStructured` (the real openrouter provider stubs `complete()` to throw).
 */
function stubLlm(data: unknown): { llm: LLMProvider; calls: () => number } {
  let calls = 0;
  const llm: LLMProvider = {
    id: 'openrouter',
    async listModels(): Promise<ModelInfo[]> {
      return [];
    },
    async complete() {
      throw new Error('complete() must never be called by the onboarding module');
    },
    async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls += 1;
      return {
        data: data as T,
        model: 'stub-model',
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 0.0012,
        raw: JSON.stringify(data),
        attempts: 1,
      };
    },
    async embed() {
      return [];
    },
  };
  return { llm, calls: () => calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateOnboarding', () => {
  it('makes exactly one completeStructured call and normalizes to the 5 kinds in order', async () => {
    // Model returns sections OUT OF ORDER and missing `run-locally` / `reading-path`.
    const { llm, calls } = stubLlm({
      sections: [
        { kind: 'first-tasks', title: 'FT', body: 'first tasks prose', diagram: null, links: [] },
        { kind: 'architecture', title: 'Arch', body: 'arch prose', diagram: 'flowchart TD\n A["app"]', links: [] },
        { kind: 'critical-paths', title: 'CP', body: 'cp prose', diagram: null, links: [] },
      ],
    });

    const { onboarding, tokensIn, tokensOut, costUsd } = await generateOnboarding(llm, 'm', fullFacts());

    expect(calls()).toBe(1);
    expect(onboarding.sections.map((s) => s.kind)).toEqual([...ONBOARDING_KINDS]);
    expect(tokensIn).toBe(100);
    expect(tokensOut).toBe(200);
    expect(costUsd).toBe(0.0012);
    // Missing kinds fall back to the skeleton body (never dropped).
    const runLocally = onboarding.sections.find((s) => s.kind === 'run-locally')!;
    expect(runLocally.body.length).toBeGreaterThan(0);
  });

  it('nulls a diagram the model puts on a non-architecture section, keeps the architecture one', async () => {
    const { llm } = stubLlm({
      sections: [
        { kind: 'architecture', title: 'A', body: 'a', diagram: 'flowchart TD\n A', links: [] },
        { kind: 'critical-paths', title: 'C', body: 'c', diagram: 'flowchart LR\n A-->B', links: [] },
        { kind: 'run-locally', title: 'R', body: 'r', diagram: 'flowchart LR\n X', links: [] },
        { kind: 'reading-path', title: 'RP', body: 'rp', diagram: null, links: [] },
        { kind: 'first-tasks', title: 'FT', body: 'ft', diagram: null, links: [] },
      ],
    });

    const { onboarding } = await generateOnboarding(llm, 'm', fullFacts());

    const arch = onboarding.sections.find((s) => s.kind === 'architecture')!;
    const crit = onboarding.sections.find((s) => s.kind === 'critical-paths')!;
    const run = onboarding.sections.find((s) => s.kind === 'run-locally')!;
    expect(arch.diagram).toBe('flowchart TD\n A');
    expect(crit.diagram).toBeNull();
    expect(run.diagram).toBeNull();
    // No section other than architecture carries a diagram.
    for (const s of onboarding.sections) {
      if (s.kind !== 'architecture') expect(s.diagram).toBeNull();
    }
  });

  it('drops a model link whose path is not in the facts allow-list', async () => {
    const { llm } = stubLlm({
      sections: [
        { kind: 'architecture', title: 'A', body: 'a', diagram: null, links: [] },
        {
          kind: 'critical-paths',
          title: 'C',
          body: 'c',
          diagram: null,
          links: [
            { label: 'evil', path: 'src/evil.ts' }, // NOT in allow-list → dropped
            { label: 'app', path: 'src/app.ts' }, // in allow-list → kept
          ],
        },
        { kind: 'run-locally', title: 'R', body: 'r', diagram: null, links: [] },
        { kind: 'reading-path', title: 'RP', body: 'rp', diagram: null, links: [] },
        { kind: 'first-tasks', title: 'FT', body: 'ft', diagram: null, links: [] },
      ],
    });

    const { onboarding } = await generateOnboarding(llm, 'm', fullFacts());

    const crit = onboarding.sections.find((s) => s.kind === 'critical-paths')!;
    expect(crit.links.map((l) => l.path)).toEqual(['src/app.ts']);
    expect(crit.links.map((l) => l.path)).not.toContain('src/evil.ts');
  });

  it('keeps model commands ONLY on run-locally — trimmed, empties dropped, capped', async () => {
    const { llm } = stubLlm({
      sections: [
        { kind: 'architecture', title: 'A', body: 'a', diagram: null, commands: ['rm -rf /'], links: [] },
        { kind: 'critical-paths', title: 'C', body: 'c', diagram: null, commands: ['echo nope'], links: [] },
        {
          kind: 'run-locally',
          title: 'R',
          body: 'r',
          diagram: null,
          commands: ['  npm install  ', '', '   ', 'npm run dev'],
          links: [],
        },
        { kind: 'reading-path', title: 'RP', body: 'rp', diagram: null, commands: ['ls'], links: [] },
        { kind: 'first-tasks', title: 'FT', body: 'ft', diagram: null, commands: ['ls'], links: [] },
      ],
    });

    const { onboarding } = await generateOnboarding(llm, 'm', fullFacts());

    const run = onboarding.sections.find((s) => s.kind === 'run-locally')!;
    expect(run.commands).toEqual(['npm install', 'npm run dev']);
    for (const s of onboarding.sections) {
      if (s.kind !== 'run-locally') expect(s.commands).toBeNull();
    }
  });

  it('strips a duplicated fenced block from the run-locally body once commands are set', async () => {
    const { llm } = stubLlm({
      sections: [
        { kind: 'architecture', title: 'A', body: 'a', diagram: null, commands: null, links: [] },
        { kind: 'critical-paths', title: 'C', body: 'c', diagram: null, commands: null, links: [] },
        {
          kind: 'run-locally',
          title: 'R',
          body: 'Install the deps first.\n\n```bash\nnpm install\nnpm run dev\n```\n\nThen open the app.',
          diagram: null,
          commands: ['npm install', 'npm run dev'],
          links: [],
        },
        { kind: 'reading-path', title: 'RP', body: 'rp', diagram: null, commands: null, links: [] },
        { kind: 'first-tasks', title: 'FT', body: 'ft', diagram: null, commands: null, links: [] },
      ],
    });

    const { onboarding } = await generateOnboarding(llm, 'm', fullFacts());

    const run = onboarding.sections.find((s) => s.kind === 'run-locally')!;
    // The commands survive structurally...
    expect(run.commands).toEqual(['npm install', 'npm run dev']);
    // ...while the body keeps its narration but no longer repeats them as a
    // block, so the client cannot render the same commands twice.
    expect(run.body).not.toContain('```');
    expect(run.body).toContain('Install the deps first.');
    expect(run.body).toContain('Then open the app.');
  });

  it('caps the model commands at RUN_LOCALLY_COMMAND_CAP', async () => {
    const { llm } = stubLlm({
      sections: [
        {
          kind: 'run-locally',
          title: 'R',
          body: 'r',
          diagram: null,
          commands: Array.from({ length: RUN_LOCALLY_COMMAND_CAP + 4 }, (_, i) => `npm run s${i}`),
          links: [],
        },
      ],
    });

    const { onboarding } = await generateOnboarding(llm, 'm', fullFacts());

    const run = onboarding.sections.find((s) => s.kind === 'run-locally')!;
    expect(run.commands).toHaveLength(RUN_LOCALLY_COMMAND_CAP);
  });

  it('falls back to the skeleton commands when the model omits or empties them', async () => {
    const facts = fullFacts();
    const skeletonCommands = buildSkeleton(facts).sections.find((s) => s.kind === 'run-locally')!.commands;
    expect(skeletonCommands).toEqual(['cp .env.example .env', 'npm run dev']);

    for (const modelCommands of [undefined, null, [], ['   ']]) {
      const { llm } = stubLlm({
        sections: [
          { kind: 'run-locally', title: 'R', body: 'model prose', diagram: null, commands: modelCommands, links: [] },
        ],
      });
      const { onboarding } = await generateOnboarding(llm, 'm', facts);
      const run = onboarding.sections.find((s) => s.kind === 'run-locally')!;
      expect(run.commands).toEqual(skeletonCommands);
    }
  });

  it('builds all 5 kinds from a degraded bundle (skeleton), first-tasks present (D3)', () => {
    const onboarding = buildSkeleton(degradedFacts());

    expect(onboarding.sections.map((s) => s.kind)).toEqual([...ONBOARDING_KINDS]);
    expect(onboarding.index_state).toBe('degraded');
    expect(onboarding.degraded_reason).toBe('no local clone');
    expect(onboarding.files_indexed).toBe(0);
    // first-tasks is never omitted, even with no facts (D3), and carries honest prose.
    const first = onboarding.sections.find((s) => s.kind === 'first-tasks')!;
    expect(first.body.length).toBeGreaterThan(0);
    // No diagram on any section in a bare skeleton, and never an empty string (AC-8).
    for (const s of onboarding.sections) expect(s.diagram).toBeNull();
  });
});
