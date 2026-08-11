import { describe, expect, it } from 'vitest';
import type { Finding } from '@devdigest/shared';
import {
  classifyExtraFindings,
  computeCitationAccuracy,
  computePass,
  computePrecision,
  computeRecall,
  matchExpectations,
} from './scoring.js';
import type { ExpectationItem } from './types.js';

function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'id' | 'file'>): Finding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    kind: null,
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

function mustFind(overrides: Partial<ExpectationItem> = {}): ExpectationItem {
  return {
    type: 'must_find',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    ...overrides,
  };
}

function mustNotFlag(overrides: Partial<ExpectationItem> = {}): ExpectationItem {
  return {
    type: 'must_not_flag',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    ...overrides,
  };
}

describe('computeCitationAccuracy (AC-14)', () => {
  it('computes the exact kept/(kept+dropped) ratio', () => {
    expect(computeCitationAccuracy(3, 1)).toBe(0.75);
  });

  it('is 1.0 when kept and dropped are both zero', () => {
    expect(computeCitationAccuracy(0, 0)).toBe(1.0);
  });
});

describe('matchExpectations — range intersection (AC-16)', () => {
  it('does NOT match adjacent, non-overlapping ranges', () => {
    const expected = [mustFind({ start_line: 1, end_line: 5 })];
    const findings = [makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 6, end_line: 10 })];
    const result = matchExpectations(expected, findings)[0]!;
    expect(result.matched).toBe(false);
  });

  it('matches when a single line overlaps (shared boundary line)', () => {
    const expected = [mustFind({ start_line: 1, end_line: 5 })];
    const findings = [makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 5, end_line: 10 })];
    const result = matchExpectations(expected, findings)[0]!;
    expect(result.matched).toBe(true);
    expect(result.finding?.id).toBe('f1');
  });

  it('matches when ranges fully overlap', () => {
    const expected = [mustFind({ start_line: 10, end_line: 12 })];
    const findings = [makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 11, end_line: 11 })];
    const result = matchExpectations(expected, findings)[0]!;
    expect(result.matched).toBe(true);
  });

  it('does not match across different files even with overlapping lines', () => {
    const expected = [mustFind({ file: 'src/a.ts', start_line: 10, end_line: 12 })];
    const findings = [makeFinding({ id: 'f1', file: 'src/b.ts', start_line: 11, end_line: 11 })];
    const result = matchExpectations(expected, findings)[0]!;
    expect(result.matched).toBe(false);
  });

  it('defaults end_line to start_line when omitted', () => {
    const expected: ExpectationItem[] = [
      { type: 'must_find', file: 'src/a.ts', start_line: 7 },
    ];
    const matchingFinding = makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 7, end_line: 7 });
    const nonMatchingFinding = makeFinding({
      id: 'f2',
      file: 'src/a.ts',
      start_line: 8,
      end_line: 8,
    });
    expect(matchExpectations(expected, [matchingFinding])[0]!.matched).toBe(true);
    expect(matchExpectations(expected, [nonMatchingFinding])[0]!.matched).toBe(false);
  });
});

describe('computeRecall (AC-15)', () => {
  it('is 0.5 when 1 of 2 must_find items is matched', () => {
    const expected = [
      mustFind({ file: 'src/a.ts', start_line: 1, end_line: 1 }),
      mustFind({ file: 'src/b.ts', start_line: 1, end_line: 1 }),
    ];
    const findings = [makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 1, end_line: 1 })];
    const matches = matchExpectations(expected, findings);
    expect(computeRecall(expected, matches)).toBe(0.5);
  });

  it('is 1.0 when there are zero must_find items (only must_not_flag)', () => {
    const expected = [mustNotFlag({ file: 'src/a.ts', start_line: 1, end_line: 1 })];
    const matches = matchExpectations(expected, []);
    expect(computeRecall(expected, matches)).toBe(1.0);
  });
});

describe('computePrecision (AC-17/AC-18)', () => {
  it('is 1/3 when 3 findings are produced and only 1 is backed', () => {
    const expected = [mustFind({ file: 'src/a.ts', start_line: 1, end_line: 1 })];
    const backed = makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 1, end_line: 1 });
    const extra1 = makeFinding({ id: 'f2', file: 'src/b.ts', start_line: 20, end_line: 20 });
    const extra2 = makeFinding({ id: 'f3', file: 'src/c.ts', start_line: 30, end_line: 30 });
    const grounded = [backed, extra1, extra2];
    const matches = matchExpectations(expected, grounded);
    expect(computePrecision(grounded, matches)).toBeCloseTo(1 / 3);
  });

  it('is 1.0 when zero findings were produced', () => {
    const expected = [mustFind()];
    const matches = matchExpectations(expected, []);
    expect(computePrecision([], matches)).toBe(1.0);
  });

  it('debits an unbacked-extra finding and a confirmed-noise finding identically', () => {
    // Scenario A: extra finding matches no expectation at all (unbacked_extra).
    const expectedA = [mustFind({ file: 'src/a.ts', start_line: 1, end_line: 1 })];
    const backedA = makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 1, end_line: 1 });
    const unbackedExtra = makeFinding({ id: 'f2', file: 'src/z.ts', start_line: 99, end_line: 99 });
    const groundedA = [backedA, unbackedExtra];
    const matchesA = matchExpectations(expectedA, groundedA);
    const precisionA = computePrecision(groundedA, matchesA);

    // Scenario B: extra finding matches a must_not_flag item (confirmed_noise).
    const expectedB = [
      mustFind({ file: 'src/a.ts', start_line: 1, end_line: 1 }),
      mustNotFlag({ file: 'src/z.ts', start_line: 99, end_line: 99 }),
    ];
    const backedB = makeFinding({ id: 'f1', file: 'src/a.ts', start_line: 1, end_line: 1 });
    const confirmedNoise = makeFinding({
      id: 'f2',
      file: 'src/z.ts',
      start_line: 99,
      end_line: 99,
    });
    const groundedB = [backedB, confirmedNoise];
    const matchesB = matchExpectations(expectedB, groundedB);
    const precisionB = computePrecision(groundedB, matchesB);

    expect(precisionA).toBe(0.5);
    expect(precisionB).toBe(0.5);
    expect(precisionA).toBe(precisionB);

    // The tags themselves DO differ (UI/trace only), even though the numeric
    // debit above is identical.
    const extrasA = classifyExtraFindings(groundedA, matchesA);
    const extrasB = classifyExtraFindings(groundedB, matchesB);
    expect(extrasA.find((e) => e.finding.id === 'f2')?.tag).toBe('unbacked_extra');
    expect(extrasB.find((e) => e.finding.id === 'f2')?.tag).toBe('confirmed_noise');
  });
});

describe('computePass (AC-19)', () => {
  it.each([
    { recall: 1.0, precision: 1.0, expected: true },
    { recall: 0.5, precision: 1.0, expected: false },
    { recall: 1.0, precision: 0.5, expected: false },
    { recall: 0.5, precision: 0.5, expected: false },
  ])('recall=$recall precision=$precision -> pass=$expected', ({ recall, precision, expected }) => {
    expect(computePass(recall, precision)).toBe(expected);
  });
});
