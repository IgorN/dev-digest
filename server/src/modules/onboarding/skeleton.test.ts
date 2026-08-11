import { describe, it, expect } from 'vitest';
import { buildSkeleton, ONBOARDING_KINDS } from './skeleton.js';
import { RUN_LOCALLY_COMMAND_CAP } from './constants.js';
import type { FactsBundle } from './facts.js';

/**
 * T4 — the deterministic 5-section skeleton assembler. PURE in / pure out: every
 * case here feeds a hand-built `FactsBundle` (no container, no clone, no DB) and
 * asserts on STRUCTURE — the fixed kind set + order (AC-7), the null diagram slot
 * (AC-8), the allow-list link filter (AC-9), the always-present first-tasks
 * section (D3), and the index-state metadata folded straight from the bundle.
 * Prose is intentionally NOT asserted — only that bodies are honest non-empty
 * strings.
 */

function makeFacts(over: Partial<FactsBundle> = {}): FactsBundle {
  return {
    repoId: 'r1',
    hasClone: true,
    indexState: { status: 'full', degraded: false, reason: null, filesIndexed: 42 },
    stack: { packageName: 'widget', frameworks: ['Next.js'], dependencies: ['next'], devDependencies: [] },
    repoMap: 'repo map',
    criticalPaths: [['a.ts', 'b.ts']],
    runLocally: {
      scripts: [{ name: 'dev', command: 'tsx watch' }],
      hasEnvExample: true,
      hasDockerCompose: true,
      hasSignals: true,
      files: ['.env.example', 'docker-compose.yml'],
    },
    readingPath: [
      { path: 'a.ts', rank: 0.9 },
      { path: 'b.ts', rank: 0.5 },
    ],
    topSymbols: [{ file: 'b.ts', name: 'doThing', kind: 'function' }],
    allowedPaths: new Set(['a.ts', 'b.ts', '.env.example', 'docker-compose.yml', 'package.json']),
    ...over,
  };
}

/** A bundle with no facts at all — the degraded / just-cloned-nothing-indexed floor (D3). */
function makeBareFacts(): FactsBundle {
  return makeFacts({
    hasClone: false,
    indexState: { status: 'degraded', degraded: true, reason: 'no local clone', filesIndexed: 0 },
    stack: { packageName: null, frameworks: [], dependencies: [], devDependencies: [] },
    repoMap: '',
    criticalPaths: [],
    runLocally: { scripts: [], hasEnvExample: false, hasDockerCompose: false, hasSignals: false, files: [] },
    readingPath: [],
    topSymbols: [],
    allowedPaths: new Set<string>(),
  });
}

describe('buildSkeleton — deterministic contract', () => {
  it('AC-7: emits exactly the 5 kinds in ONBOARDING_KINDS fixed order', () => {
    const skeleton = buildSkeleton(makeFacts());
    expect(skeleton.sections.map((s) => s.kind)).toEqual([...ONBOARDING_KINDS]);
    // Fixed set: five sections, no extras, no gaps — even on a bare bundle.
    expect(buildSkeleton(makeBareFacts()).sections.map((s) => s.kind)).toEqual([...ONBOARDING_KINDS]);
  });

  it('AC-8: every section has a null diagram slot in the skeleton (never "")', () => {
    for (const facts of [makeFacts(), makeBareFacts()]) {
      const skeleton = buildSkeleton(facts);
      for (const section of skeleton.sections) {
        expect(section.diagram).toBeNull();
        expect(section.diagram).not.toBe('');
      }
    }
  });

  it('emits deterministic run-locally commands from the env / docker / script signals', () => {
    const runLocally = buildSkeleton(makeFacts()).sections.find((s) => s.kind === 'run-locally')!;
    // Order matters: env template → dependencies → package scripts.
    expect(runLocally.commands).toEqual(['cp .env.example .env', 'docker compose up -d', 'npm run dev']);
  });

  it('derives run-locally commands ONLY from present signals — never fabricated', () => {
    const scriptsOnly = buildSkeleton(
      makeFacts({
        runLocally: {
          scripts: [
            { name: 'build', command: 'tsc' },
            { name: 'test', command: 'vitest run' },
          ],
          hasEnvExample: false,
          hasDockerCompose: false,
          hasSignals: true,
          files: [],
        },
      }),
    ).sections.find((s) => s.kind === 'run-locally')!;
    expect(scriptsOnly.commands).toEqual(['npm run build', 'npm run test']);

    const envOnly = buildSkeleton(
      makeFacts({
        runLocally: {
          scripts: [],
          hasEnvExample: true,
          hasDockerCompose: false,
          hasSignals: true,
          files: ['.env.example'],
        },
      }),
    ).sections.find((s) => s.kind === 'run-locally')!;
    expect(envOnly.commands).toEqual(['cp .env.example .env']);
  });

  it('caps run-locally commands at RUN_LOCALLY_COMMAND_CAP', () => {
    const scripts = Array.from({ length: RUN_LOCALLY_COMMAND_CAP + 5 }, (_, i) => ({
      name: `s${i}`,
      command: 'noop',
    }));
    const section = buildSkeleton(
      makeFacts({
        runLocally: { scripts, hasEnvExample: false, hasDockerCompose: false, hasSignals: true, files: [] },
      }),
    ).sections.find((s) => s.kind === 'run-locally')!;
    expect(section.commands).toHaveLength(RUN_LOCALLY_COMMAND_CAP);
  });

  it('commands are null on every section other than run-locally, and null when no signals', () => {
    for (const facts of [makeFacts(), makeBareFacts()]) {
      for (const section of buildSkeleton(facts).sections) {
        if (section.kind !== 'run-locally') expect(section.commands).toBeNull();
      }
    }
    // Bare bundle: no run-locally signals at all → no fabricated commands.
    const bare = buildSkeleton(makeBareFacts()).sections.find((s) => s.kind === 'run-locally')!;
    expect(bare.commands ?? null).toBeNull();
  });

  it('does NOT duplicate the commands as a fenced Scripts block in the body', () => {
    const runLocally = buildSkeleton(makeFacts()).sections.find((s) => s.kind === 'run-locally')!;
    expect(runLocally.body).not.toContain('```');
    expect(runLocally.body).not.toContain('**Scripts**');
  });

  it('every section carries an honest, non-empty markdown body and a title', () => {
    for (const facts of [makeFacts(), makeBareFacts()]) {
      for (const section of buildSkeleton(facts).sections) {
        expect(typeof section.body).toBe('string');
        expect(section.body.length).toBeGreaterThan(0);
        expect(section.title.length).toBeGreaterThan(0);
      }
    }
  });

  it('AC-9: links are constrained to the facts allow-list — no off-allow-list path survives', () => {
    // readingPath/critical-paths reference `dropped.ts`, which is deliberately
    // ABSENT from allowedPaths; the manifest is named (so package.json becomes a
    // candidate) but ALSO absent from allowedPaths — both must be filtered out.
    const facts = makeFacts({
      readingPath: [
        { path: 'kept.ts', rank: 0.9 },
        { path: 'dropped.ts', rank: 0.5 },
      ],
      criticalPaths: [['kept.ts', 'dropped.ts']],
      topSymbols: [{ file: 'dropped.ts', name: 'x', kind: 'function' }],
      runLocally: {
        scripts: [],
        hasEnvExample: false,
        hasDockerCompose: false,
        hasSignals: false,
        files: ['dropped.ts'],
      },
      stack: { packageName: 'widget', frameworks: [], dependencies: [], devDependencies: [] },
      allowedPaths: new Set(['kept.ts']),
    });

    const skeleton = buildSkeleton(facts);
    const allLinkPaths = skeleton.sections.flatMap((s) => s.links.map((l) => l.path));

    // Every emitted link is on the allow-list; the off-list candidates are gone.
    for (const path of allLinkPaths) {
      expect(facts.allowedPaths.has(path)).toBe(true);
    }
    expect(allLinkPaths).not.toContain('dropped.ts');
    expect(allLinkPaths).not.toContain('package.json');
    // The one allowed path still comes through where it's a candidate.
    expect(allLinkPaths).toContain('kept.ts');
  });

  it('caps links at 4 per section', () => {
    const paths = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    const facts = makeFacts({
      readingPath: paths.map((p, i) => ({ path: p, rank: 1 - i / 100 })),
      allowedPaths: new Set(paths),
      stack: { packageName: null, frameworks: [], dependencies: [], devDependencies: [] },
    });
    for (const section of buildSkeleton(facts).sections) {
      expect(section.links.length).toBeLessThanOrEqual(4);
    }
  });

  it('D3: the first-tasks section is always present, even for a bare/degraded bundle', () => {
    const skeleton = buildSkeleton(makeBareFacts());
    const firstTasks = skeleton.sections.find((s) => s.kind === 'first-tasks');
    expect(firstTasks).toBeDefined();
    expect(firstTasks!.body.length).toBeGreaterThan(0);
  });

  it('folds a DEGRADED index state (+ reason + files_indexed) straight from the bundle', () => {
    const skeleton = buildSkeleton(
      makeBareFacts(), // status degraded, reason 'no local clone', filesIndexed 0
    );
    expect(skeleton.index_state).toBe('degraded');
    expect(skeleton.degraded_reason).toBe('no local clone');
    expect(skeleton.files_indexed).toBe(0);
  });

  it('folds a FULL index state → full, null reason, real files_indexed', () => {
    const skeleton = buildSkeleton(
      makeFacts({ indexState: { status: 'full', degraded: false, reason: null, filesIndexed: 128 } }),
    );
    expect(skeleton.index_state).toBe('full');
    expect(skeleton.degraded_reason).toBeNull();
    expect(skeleton.files_indexed).toBe(128);
  });

  it('does NOT stamp generated_at — the repository sets it on upsert', () => {
    // The skeleton omits generated_at entirely; the DB column is the source of truth.
    expect(buildSkeleton(makeFacts()).generated_at ?? null).toBeNull();
  });
});
