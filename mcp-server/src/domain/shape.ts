/**
 * Domain core — pure response shaping (zero I/O). Narrows the full upstream
 * DevDigest shapes down to the small, decision-useful fields an MCP tool
 * response should carry (image rule #3, "concise structured response").
 * Nothing here imports fetch/the SDK/env — only vendored types.
 */
import type { Agent } from '../vendor/shared/agent.js';
import type { ConventionCandidate } from '../vendor/shared/knowledge.js';
import type { Finding, Severity, FindingCategory } from '../vendor/shared/findings.js';

export const DEFAULT_FINDINGS_LIMIT = 20;
export const DEFAULT_CONVENTIONS_LIMIT = 50;

export interface NarrowAgent {
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

export function narrowAgent(agent: Agent): NarrowAgent {
  return {
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    enabled: agent.enabled,
  };
}

export interface NarrowFinding {
  severity: Severity;
  category: FindingCategory;
  title: string;
  file: string;
  line: number;
  suggestion: string | null;
  confidence: number;
}

export function narrowFinding(finding: Finding): NarrowFinding {
  return {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    line: finding.start_line,
    suggestion: finding.suggestion ?? null,
    confidence: finding.confidence,
  };
}

export interface FindingsFilter {
  severity?: Severity;
  category?: FindingCategory;
  limit?: number;
}

export interface NarrowedFindings {
  total_findings: number;
  returned: number;
  findings: NarrowFinding[];
}

/** Filter by severity/category, then cap at `limit` (default 20) — the MCP
 *  layer's own narrowing, since the upstream `GET /pulls/:id/reviews` has no
 *  filter/pagination params of its own (GAP-F in the approved plan). */
export function filterAndLimitFindings(
  findings: Finding[],
  filter: FindingsFilter,
): NarrowedFindings {
  const filtered = findings.filter(
    (f) =>
      (filter.severity === undefined || f.severity === filter.severity) &&
      (filter.category === undefined || f.category === filter.category),
  );
  const limit = filter.limit ?? DEFAULT_FINDINGS_LIMIT;
  return {
    total_findings: filtered.length,
    returned: Math.min(filtered.length, limit),
    findings: filtered.slice(0, limit).map(narrowFinding),
  };
}

export interface NarrowConvention {
  category: string | null;
  rule: string;
  evidence_path: string;
  confidence: number;
}

export function narrowConvention(c: ConventionCandidate): NarrowConvention {
  return {
    category: c.category ?? null,
    rule: c.rule,
    evidence_path: c.evidence_path,
    confidence: c.confidence,
  };
}

/** Only accepted conventions by default — undecided/rejected candidates are
 *  noisy internal review state (design decision A5 in the approved plan). */
export function filterConventions(
  candidates: ConventionCandidate[],
  opts: { includeCandidates?: boolean; category?: string; limit?: number },
): NarrowConvention[] {
  const base = opts.includeCandidates
    ? candidates
    : candidates.filter((c) => c.accepted === true);
  const filtered = opts.category
    ? base.filter((c) => c.category === opts.category)
    : base;
  const limit = opts.limit ?? DEFAULT_CONVENTIONS_LIMIT;
  return filtered.slice(0, limit).map(narrowConvention);
}

export interface BlastRadiusStub {
  status: 'not_implemented';
  implemented: false;
  repo: string;
  pr_number: number;
  message: string;
  affected: never[];
}

/** Safe stub — never fabricates data. `implemented: false` is the
 *  machine-checkable marker so a caller can't mistake this for a real,
 *  empty analysis result (approved plan, section 5.5 / A7). No I/O: the
 *  repo/pr_number are echoed back for traceability, never looked up. */
export function buildBlastRadiusStub(repo: string, pr_number: number): BlastRadiusStub {
  return {
    status: 'not_implemented',
    implemented: false,
    repo,
    pr_number,
    message: 'Blast-radius analysis is not implemented yet. No analysis was performed and no data was inferred.',
    affected: [],
  };
}
