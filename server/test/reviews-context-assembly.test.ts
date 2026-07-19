import { describe, it, expect } from 'vitest';
import {
  assembleContextPaths,
  buildContextInjection,
} from '../src/modules/reviews/context-assembly.js';
import { approxTokens, truncateToBytes } from '../src/modules/context/helpers.js';
import { TRUNCATION_MARKER } from '../src/modules/context/constants.js';

/**
 * T5 — pure run-time assembly of Project Context documents (no I/O, unit lane).
 * AC-8 ordering/dedup + the per-doc outcome mapping (AC-16/18/19 shapes).
 */
describe('assembleContextPaths (AC-8)', () => {
  it('orders agent docs first, then skill docs in skill-link order', () => {
    expect(
      assembleContextPaths(
        ['docs/a.md', 'docs/b.md'],
        [['specs/s1.md', 'specs/s2.md'], ['insights/i1.md']],
      ),
    ).toEqual(['docs/a.md', 'docs/b.md', 'specs/s1.md', 'specs/s2.md', 'insights/i1.md']);
  });

  it('dedups first-occurrence-wins: agent-level position beats skill position', () => {
    expect(
      assembleContextPaths(['docs/a.md', 'docs/shared.md'], [['docs/shared.md', 'docs/c.md']]),
    ).toEqual(['docs/a.md', 'docs/shared.md', 'docs/c.md']);
  });

  it('dedups across two skills: the first skill\'s position wins', () => {
    expect(
      assembleContextPaths([], [['docs/x.md', 'docs/y.md'], ['docs/y.md', 'docs/z.md']]),
    ).toEqual(['docs/x.md', 'docs/y.md', 'docs/z.md']);
  });

  it('empty inputs produce an empty set', () => {
    expect(assembleContextPaths([], [])).toEqual([]);
    expect(assembleContextPaths([], [[], []])).toEqual([]);
  });
});

describe('buildContextInjection', () => {
  it('injected: content passed through, tokens = approxTokens(length)', () => {
    const out = buildContextInjection([{ path: 'docs/a.md', content: '# Hello world' }], 64_000);
    expect(out.specs).toEqual(['# Hello world']);
    expect(out.specsRead).toEqual(['docs/a.md']);
    expect(out.specsInjected).toEqual([
      { path: 'docs/a.md', tokens: approxTokens('# Hello world'.length), status: 'injected' },
    ]);
  });

  it('missing/unreadable (content null) → skipped_missing, tokens 0, nothing injected (AC-16)', () => {
    const out = buildContextInjection(
      [
        { path: 'docs/gone.md', content: null },
        { path: 'docs/kept.md', content: 'kept' },
      ],
      64_000,
    );
    expect(out.specs).toEqual(['kept']);
    expect(out.specsRead).toEqual(['docs/kept.md']);
    expect(out.specsInjected).toEqual([
      { path: 'docs/gone.md', tokens: 0, status: 'skipped_missing' },
      { path: 'docs/kept.md', tokens: 1, status: 'injected' },
    ]);
  });

  it('unsafe path is never injected even when content was somehow supplied (AC-19)', () => {
    const out = buildContextInjection([{ path: '../../etc/passwd', content: 'root:x' }], 64_000);
    expect(out.specs).toEqual([]);
    expect(out.specsInjected).toEqual([
      { path: '../../etc/passwd', tokens: 0, status: 'skipped_missing' },
    ]);
  });

  it('oversized doc → truncated at the cap with marker; tokens over the TRUNCATED text (AC-18)', () => {
    const cap = 64;
    const big = 'x'.repeat(500);
    const out = buildContextInjection([{ path: 'docs/big.md', content: big }], cap);
    const expected = truncateToBytes(big, cap);
    expect(expected.truncated).toBe(true);
    expect(out.specs).toEqual([expected.text]);
    expect(out.specs[0]).toContain(TRUNCATION_MARKER);
    expect(out.specsInjected).toEqual([
      { path: 'docs/big.md', tokens: approxTokens(expected.text.length), status: 'truncated' },
    ]);
    // Tokens reflect the truncated length, NOT the original 500-char doc.
    expect(out.specsInjected[0]!.tokens).toBeLessThan(approxTokens(big.length));
  });

  it('empty read set → empty injection (AC-17 upstream shape)', () => {
    expect(buildContextInjection([], 64_000)).toEqual({
      specs: [],
      specsRead: [],
      specsInjected: [],
    });
  });
});
