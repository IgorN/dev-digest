import { describe, it, expect } from 'vitest';
import {
  narrowAgent,
  narrowFinding,
  filterAndLimitFindings,
  filterConventions,
  buildBlastRadiusStub,
  DEFAULT_FINDINGS_LIMIT,
} from '../src/domain/shape.js';
import type { Finding } from '../src/vendor/shared/findings.js';
import type { ConventionCandidate } from '../src/vendor/shared/knowledge.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'bug',
    title: 'Something is wrong',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'a very long internal rationale that should not leak by default',
    suggestion: 'fix it',
    confidence: 0.9,
    ...overrides,
  };
}

describe('narrowAgent', () => {
  it('drops system_prompt/output_schema and keeps only decision-useful fields', () => {
    const narrowed = narrowAgent({
      id: 'a1',
      name: 'Strict Reviewer',
      description: 'desc',
      provider: 'anthropic',
      model: 'claude-x',
      enabled: true,
    });
    expect(narrowed).toEqual({
      name: 'Strict Reviewer',
      description: 'desc',
      provider: 'anthropic',
      model: 'claude-x',
      enabled: true,
    });
  });
});

describe('narrowFinding', () => {
  it('maps start_line to line and drops rationale', () => {
    const narrowed = narrowFinding(finding());
    expect(narrowed).toEqual({
      severity: 'CRITICAL',
      category: 'bug',
      title: 'Something is wrong',
      file: 'src/x.ts',
      line: 10,
      suggestion: 'fix it',
      confidence: 0.9,
    });
    expect(narrowed).not.toHaveProperty('rationale');
  });
});

describe('filterAndLimitFindings', () => {
  const findings = [
    finding({ id: 'f1', severity: 'CRITICAL' }),
    finding({ id: 'f2', severity: 'WARNING' }),
    finding({ id: 'f3', severity: 'CRITICAL', category: 'security' }),
  ];

  it('defaults to a bounded limit so responses stay narrow', () => {
    const result = filterAndLimitFindings(findings, {});
    expect(result.total_findings).toBe(3);
    expect(result.returned).toBe(3);
    expect(DEFAULT_FINDINGS_LIMIT).toBeGreaterThanOrEqual(3);
  });

  it('filters by severity', () => {
    const result = filterAndLimitFindings(findings, { severity: 'CRITICAL' });
    expect(result.total_findings).toBe(2);
    expect(result.findings.every((f) => f.severity === 'CRITICAL')).toBe(true);
  });

  it('filters by category', () => {
    const result = filterAndLimitFindings(findings, { category: 'security' });
    expect(result.total_findings).toBe(1);
  });

  it('caps returned findings at limit while reporting the true total', () => {
    const result = filterAndLimitFindings(findings, { limit: 1 });
    expect(result.total_findings).toBe(3);
    expect(result.returned).toBe(1);
    expect(result.findings).toHaveLength(1);
  });
});

describe('filterConventions', () => {
  const candidates: ConventionCandidate[] = [
    { id: 'c1', category: 'style', rule: 'use tabs', evidence_path: 'a.ts', confidence: 0.8, accepted: true },
    { id: 'c2', category: 'style', rule: 'maybe use spaces', evidence_path: 'b.ts', confidence: 0.5, accepted: null },
    { id: 'c3', category: 'style', rule: 'rejected rule', evidence_path: 'c.ts', confidence: 0.3, accepted: false },
  ];

  it('defaults to accepted-only (design decision A5)', () => {
    const result = filterConventions(candidates, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('use tabs');
  });

  it('includes candidates when include_candidates=true', () => {
    const result = filterConventions(candidates, { includeCandidates: true });
    expect(result).toHaveLength(3);
  });
});

describe('buildBlastRadiusStub', () => {
  it('always marks implemented:false and never fabricates affected data', () => {
    const stub = buildBlastRadiusStub('owner/repo', 42);
    expect(stub).toEqual({
      status: 'not_implemented',
      implemented: false,
      repo: 'owner/repo',
      pr_number: 42,
      message: expect.stringContaining('not implemented'),
      affected: [],
    });
  });
});
