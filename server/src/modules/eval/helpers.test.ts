import { describe, expect, it } from 'vitest';
import type { EvalRun, EvalTrendPoint, Finding, UnifiedDiff } from '@devdigest/shared';
import {
  buildExpectationFromFinding,
  buildTrendPoint,
  resolveDisposition,
  selectNotableMetric,
  sliceDiffForFile,
} from './helpers.js';

function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'id' | 'file'>): Finding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    kind: null,
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

function makeTrendPoint(overrides: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    run_id: 'batch-1',
    agent_version: 1,
    ran_at: '2026-07-29T00:00:00.000Z',
    recall: 0.8,
    precision: 0.8,
    citation_accuracy: 0.8,
    pass_rate: 0.5,
    cost_usd: 0.01,
    ...overrides,
  };
}

function makeEvalRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 100,
    cost_usd: 0.01,
    per_trace: [],
    ...overrides,
  };
}

describe('resolveDisposition (AC-1/AC-2 tie-break)', () => {
  it('is pending when both timestamps are null', () => {
    expect(resolveDisposition(null, null)).toBe('pending');
  });

  it('is accepted when only accepted_at is set', () => {
    expect(resolveDisposition('2026-07-29T00:00:00.000Z', null)).toBe('accepted');
  });

  it('is dismissed when only dismissed_at is set', () => {
    expect(resolveDisposition(null, '2026-07-29T00:00:00.000Z')).toBe('dismissed');
  });

  it('is accepted when both are set and accepted is later', () => {
    expect(
      resolveDisposition('2026-07-29T01:00:00.000Z', '2026-07-29T00:00:00.000Z'),
    ).toBe('accepted');
  });

  it('is dismissed when both are set and dismissed is later', () => {
    expect(
      resolveDisposition('2026-07-29T00:00:00.000Z', '2026-07-29T01:00:00.000Z'),
    ).toBe('dismissed');
  });

  it('accepts Date instances, not just strings', () => {
    const earlier = new Date('2026-07-29T00:00:00.000Z');
    const later = new Date('2026-07-29T01:00:00.000Z');
    expect(resolveDisposition(earlier, later)).toBe('dismissed');
  });
});

describe('buildExpectationFromFinding (AC-1/AC-2)', () => {
  it('produces one must_find item for an accepted finding, copying fields', () => {
    const finding = makeFinding({
      id: 'f1',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'SQL injection',
    });
    const items = buildExpectationFromFinding(finding, 'accepted');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      type: 'must_find',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'SQL injection',
    });
  });

  it('produces one must_not_flag item for a dismissed finding', () => {
    const finding = makeFinding({ id: 'f2', file: 'src/b.ts' });
    const items = buildExpectationFromFinding(finding, 'dismissed');
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('must_not_flag');
    expect(items[0]?.file).toBe('src/b.ts');
  });
});

describe('sliceDiffForFile (AC-5)', () => {
  const raw = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' line1',
    '+line2',
    ' line3',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1,1 +1,2 @@',
    ' line1',
    '+line2',
    '',
  ].join('\n');

  const diff: UnifiedDiff = {
    raw,
    files: [
      {
        path: 'src/a.ts',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            file: 'src/a.ts',
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 3,
            newLineNumbers: [1, 2, 3],
          },
        ],
      },
      {
        path: 'src/b.ts',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            file: 'src/b.ts',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            newLineNumbers: [1, 2],
          },
        ],
      },
    ],
  };

  it('restricts the files array to only the target file', () => {
    const sliced = sliceDiffForFile(diff, 'src/a.ts');
    expect(sliced.files).toHaveLength(1);
    expect(sliced.files[0]?.path).toBe('src/a.ts');
  });

  it('restricts the raw text to only the target file section', () => {
    const sliced = sliceDiffForFile(diff, 'src/a.ts');
    expect(sliced.raw).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(sliced.raw).not.toContain('src/b.ts');
  });

  it('returns an empty files array and raw for an unknown file', () => {
    const sliced = sliceDiffForFile(diff, 'src/unknown.ts');
    expect(sliced.files).toHaveLength(0);
    expect(sliced.raw).toBe('');
  });
});

describe('selectNotableMetric (AC-34)', () => {
  it('returns null when there is no previous batch (fewer than 2 batches)', () => {
    const latest = makeTrendPoint();
    expect(selectNotableMetric(latest, undefined)).toBeNull();
  });

  it('picks recall when it has the largest absolute delta and reports improvement', () => {
    const previous = makeTrendPoint({ recall: 0.5, precision: 0.8, citation_accuracy: 0.8 });
    const latest = makeTrendPoint({
      agent_version: 2,
      recall: 0.9, // +0.4
      precision: 0.82, // +0.02
      citation_accuracy: 0.78, // -0.02
    });
    const result = selectNotableMetric(latest, previous);
    expect(result).not.toBeNull();
    expect(result!.metric).toBe('recall');
    expect(result!.delta).toBeCloseTo(0.4);
    expect(result!.message).toContain('Recall');
    expect(result!.message).toContain('improved');
    expect(result!.message).toContain('v2');
  });

  it('picks precision when it has the largest absolute delta and reports a drop', () => {
    const previous = makeTrendPoint({ recall: 0.8, precision: 0.9, citation_accuracy: 0.8 });
    const latest = makeTrendPoint({
      agent_version: 3,
      recall: 0.81, // +0.01
      precision: 0.4, // -0.5
      citation_accuracy: 0.79, // -0.01
    });
    const result = selectNotableMetric(latest, previous);
    expect(result!.metric).toBe('precision');
    expect(result!.delta).toBeCloseTo(-0.5);
    expect(result!.message).toContain('Precision');
    expect(result!.message).toContain('dropped');
  });

  it('picks citation_accuracy when it has the largest absolute delta', () => {
    const previous = makeTrendPoint({ recall: 0.8, precision: 0.8, citation_accuracy: 0.9 });
    const latest = makeTrendPoint({
      recall: 0.79, // -0.01
      precision: 0.81, // +0.01
      citation_accuracy: 0.3, // -0.6
    });
    const result = selectNotableMetric(latest, previous);
    expect(result!.metric).toBe('citation_accuracy');
    expect(result!.delta).toBeCloseTo(-0.6);
    expect(result!.message).toContain('Citation accuracy');
  });

  it('makes no LLM/model calls: its signature takes no container/LLMProvider parameter', () => {
    // Verified by reading the function body (not a grep on identifiers, which
    // can false-positive on an explanatory comment — server/INSIGHTS.md,
    // 2026-07-12): `selectNotableMetric` takes exactly two parameters
    // (`latest`, `previous`), both plain `EvalTrendPoint`-shaped data, no
    // `container`/provider/client argument of any kind.
    expect(selectNotableMetric.length).toBe(2);
  });
});

describe('buildTrendPoint', () => {
  it('aggregates mean recall/precision/citation_accuracy, pass_rate, and summed cost', () => {
    const runs: EvalRun[] = [
      makeEvalRun({ recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.01 }),
      makeEvalRun({ recall: 0.5, precision: 0.5, citation_accuracy: 0.5, traces_passed: 0, traces_total: 1, cost_usd: 0.02 }),
    ];
    const point = buildTrendPoint('batch-1', 2, '2026-07-29T00:00:00.000Z', runs);
    expect(point.run_id).toBe('batch-1');
    expect(point.agent_version).toBe(2);
    expect(point.ran_at).toBe('2026-07-29T00:00:00.000Z');
    expect(point.recall).toBeCloseTo(0.75);
    expect(point.precision).toBeCloseTo(0.75);
    expect(point.citation_accuracy).toBeCloseTo(0.75);
    expect(point.pass_rate).toBeCloseTo(0.5);
    expect(point.cost_usd).toBeCloseTo(0.03);
  });

  it('excludes null costs from the sum without failing (null-safe)', () => {
    const runs: EvalRun[] = [
      makeEvalRun({ cost_usd: 0.01 }),
      makeEvalRun({ cost_usd: null }),
    ];
    const point = buildTrendPoint('batch-2', 1, '2026-07-29T00:00:00.000Z', runs);
    expect(point.cost_usd).toBeCloseTo(0.01);
  });

  it('cost_usd is null when every run has a null cost', () => {
    const runs: EvalRun[] = [makeEvalRun({ cost_usd: null }), makeEvalRun({ cost_usd: null })];
    const point = buildTrendPoint('batch-3', 1, '2026-07-29T00:00:00.000Z', runs);
    expect(point.cost_usd).toBeNull();
  });

  it('treats a run with zero traces_total as vacuously passed', () => {
    const runs: EvalRun[] = [makeEvalRun({ traces_total: 0, traces_passed: 0 })];
    const point = buildTrendPoint('batch-4', 1, '2026-07-29T00:00:00.000Z', runs);
    expect(point.pass_rate).toBe(1);
  });

  it('returns a zeroed point for an empty run set', () => {
    const point = buildTrendPoint('batch-5', 1, '2026-07-29T00:00:00.000Z', []);
    expect(point.recall).toBe(0);
    expect(point.precision).toBe(0);
    expect(point.citation_accuracy).toBe(0);
    expect(point.pass_rate).toBe(0);
    expect(point.cost_usd).toBeNull();
  });
});
