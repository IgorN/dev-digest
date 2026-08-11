/**
 * Actions-facing output — annotations, job summary, final log line.
 *
 * These are the only surfaces a developer sees on a failed run page, so the
 * assertions are about what is READABLE there, not about internal shapes.
 */
import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { annotationsFor, finalLineFor, jobSummaryFor } from './summary.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL Injection in Notes Search',
    file: 'app/Http/Controllers/NoteController.php',
    start_line: 18,
    end_line: 31,
    rationale: 'The query parameter is interpolated into raw SQL.',
    suggestion: 'Use parameterized queries.',
    confidence: 0.9,
    ...over,
  } as Finding;
}

describe('annotationsFor', () => {
  it('emits one workflow command per finding, anchored to the file and line', () => {
    const line = annotationsFor([finding()])[0]!;
    expect(line).toContain('::error ');
    expect(line).toContain('file=app/Http/Controllers/NoteController.php');
    expect(line).toContain('line=18');
    expect(line).toContain('endLine=31');
    expect(line).toContain('title=DevDigest%3A SQL Injection in Notes Search');
  });

  it('maps severity onto the three annotation levels', () => {
    const levels = annotationsFor([
      finding({ severity: 'CRITICAL' }),
      finding({ severity: 'WARNING' }),
      finding({ severity: 'SUGGESTION' }),
    ]).map((l) => l.slice(2, l.indexOf(' ')));
    expect(levels).toEqual(['error', 'warning', 'notice']);
  });

  it('escapes commas and colons in property values', () => {
    // Unescaped, a comma ends the property list and everything after it is
    // parsed as another property — the annotation silently loses its message.
    const line = annotationsFor([finding({ title: 'Broken: auth, badly' })])[0]!;
    expect(line).toContain('title=DevDigest%3A Broken%3A auth%2C badly');
    expect(line).not.toContain('title=DevDigest: Broken: auth, badly');
  });

  it('escapes newlines in the message so a multi-line rationale stays one annotation', () => {
    const line = annotationsFor([finding({ rationale: 'line one\nline two' })])[0]!;
    expect(line).toContain('line one%0Aline two');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('returns nothing for a clean review', () => {
    expect(annotationsFor([])).toEqual([]);
  });
});

describe('jobSummaryFor', () => {
  const base = {
    agent: 'Security Reviewer',
    blockers: 1,
    gateTriggered: true,
    failOn: 'critical',
    costUsd: 0.16509,
    durationMs: 21937,
    prNumber: 1,
    postedTo: 'github_review',
  };

  it('states the outcome, the counts and every finding with its location', () => {
    const md = jobSummaryFor({ ...base, findings: [finding()] });
    expect(md).toContain('## DevDigest — Security Reviewer');
    expect(md).toContain('**1 findings**');
    expect(md).toContain('SQL Injection in Notes Search');
    expect(md).toContain('`app/Http/Controllers/NoteController.php:18`');
    expect(md).toContain('$0.1651');
    expect(md).toContain('21.9s');
  });

  it('explains a blocked run as the gate working, not as a broken runner', () => {
    const md = jobSummaryFor({ ...base, findings: [finding()] });
    expect(md).toContain('Merge blocked');
    expect(md).toContain('fail_on: critical');
    expect(md).toMatch(/gate working/i);
  });

  it('reports a clean review without inventing a findings table', () => {
    const md = jobSummaryFor({
      ...base,
      findings: [],
      blockers: 0,
      gateTriggered: false,
    });
    expect(md).toContain('**No findings.**');
    expect(md).toContain('Not blocking');
    expect(md).not.toContain('| Severity |');
  });

  it('escapes a pipe in a title so it cannot break the table', () => {
    const md = jobSummaryFor({ ...base, findings: [finding({ title: 'a | b' })] });
    expect(md).toContain('a \\| b');
  });
});

describe('finalLineFor', () => {
  it('says why the step is about to fail', () => {
    expect(
      finalLineFor({ findings: 5, blockers: 4, gateTriggered: true, failOn: 'critical' }),
    ).toBe(
      '[agent-runner] BLOCKED: 4 of 5 findings are at or above fail_on=critical. ' +
        'Exiting non-zero to stop the merge.',
    );
  });

  it('distinguishes findings-but-not-blocking from a clean run', () => {
    expect(
      finalLineFor({ findings: 3, blockers: 0, gateTriggered: false, failOn: 'never' }),
    ).toContain('none at or above fail_on=never');
    expect(
      finalLineFor({ findings: 0, blockers: 0, gateTriggered: false, failOn: 'critical' }),
    ).toBe('[agent-runner] OK: no findings.');
  });
});
