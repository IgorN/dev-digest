import { describe, it, expect } from 'vitest';
import { verifyCandidates, type RawCandidate } from '../src/modules/conventions/verify.js';
import { buildSkillDraft } from '../src/modules/conventions/skill-draft.js';
import { githubBlobUrl } from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/db/rows.js';

// note: real files use double quotes + semicolons; the model often paraphrases —
// anchor-based verification copes with that by locating a distinctive token.
const ESLINT = `export default [
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
    },
  },
];
`;

describe('verifyCandidates (anchor-based)', () => {
  const files = new Map<string, string>([['eslint.config.js', ESLINT]]);

  const valid: RawCandidate = {
    category: 'imports',
    rule: 'Use type-only imports.',
    evidence_path: 'eslint.config.js',
    evidence_anchor: 'consistent-type-imports',
    confidence: 0.9,
  };

  it('locates the anchor and extracts the REAL multi-line snippet + line range', () => {
    const out = verifyCandidates([valid], files);
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence_start_line).toBe(4); // the rule line
    expect(out[0]!.evidence_end_line).toBeGreaterThan(4); // pulled continuation lines
    // snippet comes from the FILE (double quotes), not the model
    expect(out[0]!.evidence_snippet).toContain('"@typescript-eslint/consistent-type-imports"');
  });

  it('matches an anchor even when the model paraphrased quotes elsewhere', () => {
    const out = verifyCandidates(
      [{ ...valid, rule: '1TBS', evidence_anchor: '@stylistic/brace-style' }],
      files,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence_snippet).toContain('1tbs');
  });

  it('drops candidates with an unknown path', () => {
    expect(verifyCandidates([{ ...valid, evidence_path: 'nope.js' }], files)).toHaveLength(0);
  });

  it('drops candidates whose anchor is not in the file (hallucination)', () => {
    expect(verifyCandidates([{ ...valid, evidence_anchor: 'totallyInvented' }], files)).toHaveLength(0);
  });

  it('drops a too-short/common anchor', () => {
    expect(verifyCandidates([{ ...valid, evidence_anchor: 'err' }], files)).toHaveLength(0);
  });

  it('dedupes candidates that resolve to the same path+line', () => {
    expect(verifyCandidates([valid, { ...valid }], files)).toHaveLength(1);
  });
});

describe('githubBlobUrl', () => {
  it('builds a blob link with a line range', () => {
    expect(
      githubBlobUrl({ owner: 'acme', name: 'payments-api', ref: 'main', path: 'src/a.ts', startLine: 7, endLine: 8 }),
    ).toBe('https://github.com/acme/payments-api/blob/main/src/a.ts#L7-L8');
  });
  it('single-line uses #L{n}', () => {
    expect(
      githubBlobUrl({ owner: 'acme', name: 'payments-api', ref: 'main', path: 'src/a.ts', startLine: 7, endLine: 7 }),
    ).toBe('https://github.com/acme/payments-api/blob/main/src/a.ts#L7');
  });
});

describe('buildSkillDraft', () => {
  const row = (over: Partial<ConventionRow>): ConventionRow =>
    ({
      id: 'c1',
      workspaceId: 'w',
      repoId: 'r',
      category: 'async',
      rule: 'Use async/await instead of .then() chains.',
      evidencePath: 'src/api/users.ts',
      evidenceSnippet: 'const x = await y();',
      evidenceStartLine: 7,
      evidenceEndLine: 8,
      confidence: 0.9,
      accepted: true,
      ...over,
    }) as ConventionRow;

  it('merges accepted candidates into a repo-conventions skill body', () => {
    const draft = buildSkillDraft('payments-api', [row({})]);
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.count).toBe(1);
    expect(draft.body).toContain('# payments-api-conventions');
    expect(draft.body).toContain('House conventions for `payments-api`');
    expect(draft.body).toContain('Use async/await instead of .then() chains.');
    expect(draft.body).toContain('Detected in `src/api/users.ts:7-8`');
  });
});
