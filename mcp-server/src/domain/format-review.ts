/**
 * Domain core — pure terminal formatting (zero I/O). Turns a reviewer-core
 * `ReviewOutcome` into plain text for stdout; no ANSI color (kept simple —
 * a future enhancement, not required here).
 */
import type { ReviewOutcome } from '@devdigest/reviewer-core';

const SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

export function formatReviewForTerminal(
  outcome: ReviewOutcome,
  opts: { agentName: string; model: string; filesChanged: number },
): string {
  const { review, dropped, tokensIn, tokensOut, costUsd } = outcome;
  const lines: string[] = [];

  lines.push(`DevDigest — reviewing working tree (${opts.filesChanged} file(s) changed)`);
  lines.push(`Agent: ${opts.agentName} (${opts.model})`);
  lines.push('');
  lines.push(`Verdict: ${review.verdict.toUpperCase()} · Score: ${review.score}/100`);
  lines.push(review.summary);
  lines.push('');

  if (review.findings.length === 0) {
    lines.push('No findings.');
  } else {
    const sorted = [...review.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      lines.push(`[${f.severity}] ${f.title}`);
      lines.push(`  ${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ''}`);
      lines.push(`  ${f.rationale}`);
      if (f.suggestion) lines.push(`  Suggestion: ${f.suggestion}`);
      lines.push('');
    }
  }

  if (dropped.length > 0) {
    lines.push(`(${dropped.length} finding(s) dropped by the citation-grounding gate — no matching line in the diff)`);
    lines.push('');
  }

  const counts = SEVERITY_ORDER.map(
    (sev) => `${review.findings.filter((f) => f.severity === sev).length} ${sev.toLowerCase()}`,
  ).join(', ');
  const cost = costUsd != null ? ` · $${costUsd.toFixed(4)}` : '';
  lines.push(`${review.findings.length} finding(s) (${counts}) · ${tokensIn} in / ${tokensOut} out tok${cost}`);

  return lines.join('\n');
}
