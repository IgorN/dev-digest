import { describe, it, expect } from 'vitest';
import { computeGroups } from './grouping.js';
import type { GroupingAgent, GroupingFinding } from './types.js';

/**
 * Cross-agent grouping — AC-6 … AC-15 plus the spec's edge cases, asserted
 * against the PURE function with no database, no container and no LLM.
 */

let seq = 0;
function finding(partial: Partial<GroupingFinding> = {}): GroupingFinding {
  seq += 1;
  return {
    id: `f${seq}`,
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    severity: 'WARNING',
    title: `Finding ${seq}`,
    rationale: 'because reasons',
    confidence: 0.5,
    ...partial,
  };
}

function agent(
  cellKey: string,
  findings: GroupingFinding[] = [],
  status: string | null = 'done',
): GroupingAgent {
  return { cellKey, status, findings };
}

describe('computeGroups — co-location (AC-6)', () => {
  it('does NOT group adjacent, non-overlapping ranges [1,5] / [6,10]', () => {
    const groups = computeGroups([
      agent('a', [finding({ id: 'x', start_line: 1, end_line: 5 })]),
      agent('b', [finding({ id: 'y', start_line: 6, end_line: 10 })]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.line)).toEqual([1, 6]);
  });

  it('DOES group ranges sharing a single boundary line [1,5] / [5,10]', () => {
    const groups = computeGroups([
      agent('a', [finding({ id: 'x', start_line: 1, end_line: 5 })]),
      agent('b', [finding({ id: 'y', start_line: 5, end_line: 10 })]),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('never groups across different files even at identical lines', () => {
    const groups = computeGroups([
      agent('a', [finding({ file: 'src/a.ts', start_line: 10, end_line: 20 })]),
      agent('b', [finding({ file: 'src/b.ts', start_line: 10, end_line: 20 })]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('computeGroups — transitivity and location (AC-7, AC-8)', () => {
  it('folds the A[10,20]–B[18,30]–C[28,40] chain into ONE group reporting line 10', () => {
    const groups = computeGroups([
      agent('a', [finding({ id: 'a1', start_line: 10, end_line: 20 })]),
      agent('b', [finding({ id: 'b1', start_line: 18, end_line: 30 })]),
      agent('c', [finding({ id: 'c1', start_line: 28, end_line: 40 })]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.line).toBe(10);
    expect(groups[0]!.cells.filter((c) => c.verdict === 'flagged')).toHaveLength(3);
  });
});

describe('computeGroups — deterministic label (AC-9)', () => {
  const tied: GroupingFinding[][] = [
    [finding({ id: 'f-a', title: 'Alpha', severity: 'WARNING', confidence: 0.7, start_line: 5, end_line: 9 })],
    [finding({ id: 'f-b', title: 'Bravo', severity: 'WARNING', confidence: 0.7, start_line: 5, end_line: 9 })],
    [finding({ id: 'f-c', title: 'Charlie', severity: 'CRITICAL', confidence: 0.3, start_line: 6, end_line: 8 })],
  ];

  it('labels with the highest-severity finding, not the first-seen one', () => {
    const groups = computeGroups([agent('a', tied[0]!), agent('b', tied[1]!), agent('c', tied[2]!)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Charlie');
  });

  it('produces the same label across repeated runs and shuffled input orderings', () => {
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ];
    const labels = orders.map((order) => {
      const agents = order.map((i) => agent(`ag${i}`, tied[i]!));
      return computeGroups(agents)[0]!.label;
    });
    expect(new Set(labels).size).toBe(1);
    // And stable when called twice with the identical input.
    const agents = [agent('a', tied[0]!), agent('b', tied[1]!), agent('c', tied[2]!)];
    expect(computeGroups(agents)[0]!.label).toBe(computeGroups(agents)[0]!.label);
  });

  it('breaks a full severity/confidence/line tie by agent order, then finding id', () => {
    const same = { severity: 'WARNING', confidence: 0.5, start_line: 5, end_line: 9 };
    const groups = computeGroups([
      agent('first', [finding({ id: 'zzz', title: 'From first agent', ...same })]),
      agent('second', [finding({ id: 'aaa', title: 'From second agent', ...same })]),
    ]);
    expect(groups[0]!.label).toBe('From first agent');
  });
});

describe('computeGroups — one cell per participating agent (AC-10)', () => {
  it('emits four cells in every group of a four-agent multi-run, in agent order', () => {
    const groups = computeGroups([
      agent('a', [finding({ start_line: 10, end_line: 12 })]),
      agent('b', []),
      agent('c', [finding({ start_line: 40, end_line: 44 })]),
      agent('d', []),
    ]);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.cells).toHaveLength(4);
      expect(group.cells.map((c) => c.agent_id)).toEqual(['a', 'b', 'c', 'd']);
    }
  });
});

describe('computeGroups — verdicts (AC-11, AC-12, AC-13)', () => {
  it('gives a flagging agent ONE cell at its highest severity, with a rationale (AC-11)', () => {
    const groups = computeGroups([
      agent('a', [
        finding({ id: 'w', severity: 'WARNING', start_line: 10, end_line: 20, rationale: 'Serious\n\nproblem here' }),
        finding({ id: 's', severity: 'SUGGESTION', start_line: 12, end_line: 14, rationale: 'nit' }),
      ]),
    ]);
    expect(groups).toHaveLength(1);
    const [cell] = groups[0]!.cells;
    expect(groups[0]!.cells).toHaveLength(1);
    expect(cell!.verdict).toBe('flagged');
    expect(cell!.severity).toBe('WARNING');
    expect(cell!.finding_id).toBe('w');
    expect(cell!.rationale).toBe('Serious problem here');
  });

  it('clips a long rationale to a single line', () => {
    const long = 'x'.repeat(500);
    const groups = computeGroups([agent('a', [finding({ rationale: long })])]);
    expect(groups[0]!.cells[0]!.rationale!.length).toBeLessThanOrEqual(160);
    expect(groups[0]!.cells[0]!.rationale!.endsWith('…')).toBe(true);
  });

  it('reports a successful, zero-finding agent as did_not_flag (AC-12)', () => {
    const groups = computeGroups([
      agent('a', [finding({ start_line: 10, end_line: 20 })]),
      agent('quiet', [], 'done'),
    ]);
    expect(groups[0]!.cells[1]).toMatchObject({ agent_id: 'quiet', verdict: 'did_not_flag' });
    expect(groups[0]!.cells[1]!.rationale ?? null).toBeNull();
  });

  it.each(['failed', 'cancelled', 'running', null])(
    'reports a %s run as no_result, never did_not_flag (AC-13)',
    (status) => {
      const groups = computeGroups([
        agent('a', [finding({ start_line: 10, end_line: 20 })]),
        agent('broken', [], status),
      ]);
      expect(groups[0]!.cells[1]!.verdict).toBe('no_result');
      expect(groups[0]!.cells[1]!.verdict).not.toBe('did_not_flag');
    },
  );
});

describe('computeGroups — conflicts (AC-14)', () => {
  const at = (severity: string) => [finding({ severity, start_line: 10, end_line: 20 })];

  it('{WARNING, SUGGESTION} is a conflict', () => {
    const groups = computeGroups([agent('a', at('WARNING')), agent('b', at('SUGGESTION'))]);
    expect(groups[0]!.conflict).toBe(true);
  });

  it('{WARNING, did not flag} is NOT a conflict — silence is not a verdict', () => {
    // One agent raising something the others never looked at is a unique find,
    // not a disagreement. Counting silence made every real group a conflict and
    // turned `Show only conflicts` into a no-op.
    const groups = computeGroups([agent('a', at('WARNING')), agent('b', [], 'done')]);
    expect(groups[0]!.conflict).toBe(false);
  });

  it('{CRITICAL, did not flag, did not flag} is NOT a conflict', () => {
    const groups = computeGroups([
      agent('a', at('CRITICAL')),
      agent('b', [], 'done'),
      agent('c', [], 'done'),
    ]);
    expect(groups[0]!.conflict).toBe(false);
  });

  it('{CRITICAL, SUGGESTION, did not flag} IS a conflict — the two who spoke disagree', () => {
    const groups = computeGroups([
      agent('a', at('CRITICAL')),
      agent('b', at('SUGGESTION')),
      agent('c', [], 'done'),
    ]);
    expect(groups[0]!.conflict).toBe(true);
  });

  it('{WARNING, WARNING, WARNING} is NOT a conflict', () => {
    const groups = computeGroups([
      agent('a', at('WARNING')),
      agent('b', at('WARNING')),
      agent('c', at('WARNING')),
    ]);
    expect(groups[0]!.conflict).toBe(false);
  });

  it('{WARNING, no result} is NOT a conflict — no_result is excluded', () => {
    const groups = computeGroups([agent('a', at('WARNING')), agent('b', [], 'failed')]);
    expect(groups[0]!.conflict).toBe(false);
  });
});

describe('computeGroups — ordering (AC-15)', () => {
  it('returns one group per location, ordered by file then group line', () => {
    const groups = computeGroups([
      agent('a', [
        finding({ file: 'src/z.ts', start_line: 5, end_line: 6 }),
        finding({ file: 'src/a.ts', start_line: 90, end_line: 95 }),
        finding({ file: 'src/a.ts', start_line: 10, end_line: 12 }),
      ]),
    ]);
    expect(groups.map((g) => `${g.file}:${g.line}`)).toEqual([
      'src/a.ts:10',
      'src/a.ts:90',
      'src/z.ts:5',
    ]);
  });

  it('returns no groups at all when nobody flagged anything (AC-58 input)', () => {
    expect(computeGroups([agent('a'), agent('b')])).toEqual([]);
  });
});

describe('computeGroups — spec edge cases', () => {
  it('collapses two findings from the SAME agent in one group into one cell', () => {
    const groups = computeGroups([
      agent('solo', [
        finding({ id: 'p', start_line: 10, end_line: 20 }),
        finding({ id: 'q', start_line: 15, end_line: 25 }),
      ]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.cells).toHaveLength(1);
    expect(groups[0]!.cells[0]!.verdict).toBe('flagged');
  });

  it('never marks a single-agent multi-run as a conflict', () => {
    const groups = computeGroups([
      agent('solo', [
        finding({ severity: 'CRITICAL', start_line: 1, end_line: 2 }),
        finding({ severity: 'SUGGESTION', file: 'src/b.ts', start_line: 1, end_line: 2 }),
      ]),
    ]);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.cells).toHaveLength(1);
      expect(group.conflict).toBe(false);
    }
  });
});
