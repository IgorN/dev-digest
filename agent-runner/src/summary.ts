/**
 * Actions-facing output: job summary, inline annotations, and the final log line.
 *
 * Everything here is a PURE renderer returning strings — nothing writes, prints
 * or reads the environment, so it is unit-testable without a fake filesystem and
 * `index.ts` stays the only place that touches the real world.
 *
 * Why this exists: the runner used to emit one machine-shaped line
 * (`findings=5 blockers=4 gateTriggered=true`) and then exit 1. A developer
 * landing on the failed Actions run — the first place anyone looks when a check
 * goes red — saw no findings, no reason, and no link. The findings were only ever
 * visible on the PR conversation tab, and with `post_as: none` they were visible
 * nowhere at all.
 */
import type { Finding, Severity } from '@devdigest/shared';

/** GitHub renders `error` > `warning` > `notice` with decreasing prominence. */
const ANNOTATION_LEVEL: Record<Severity, 'error' | 'warning' | 'notice'> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  SUGGESTION: 'notice',
};

const SEVERITY_ICON: Record<Severity, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  SUGGESTION: '🔵',
};

/**
 * Workflow-command escaping. The message body escapes `%`, CR and LF; property
 * VALUES additionally escape `:` and `,`, which otherwise terminate the property
 * list. Skipping this is not cosmetic — a rationale containing a comma silently
 * truncates the annotation and everything after it is parsed as garbage.
 */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * One workflow command per finding. GitHub places these inline on the diff in
 * "Files changed" and in the run's Annotations block, so a reviewer sees the
 * problem at the line without opening the review.
 */
export function annotationsFor(findings: Finding[]): string[] {
  return findings.map((f) => {
    const level = ANNOTATION_LEVEL[f.severity];
    const props = [
      `file=${escapeProperty(f.file)}`,
      `line=${f.start_line}`,
      // GitHub ignores endLine < line; findings are grounded against the diff,
      // so this is defensive rather than expected.
      `endLine=${Math.max(f.end_line, f.start_line)}`,
      `title=${escapeProperty(`DevDigest: ${f.title}`)}`,
    ].join(',');
    const body = f.suggestion ? `${f.rationale}\n\nSuggestion: ${f.suggestion}` : f.rationale;
    return `::${level} ${props}::${escapeData(body)}`;
  });
}

export interface SummaryInput {
  agent: string;
  findings: Finding[];
  blockers: number;
  gateTriggered: boolean;
  failOn: string;
  costUsd: number;
  durationMs: number;
  prNumber: number;
  postedTo: string;
}

/**
 * Markdown for `$GITHUB_STEP_SUMMARY`, rendered on the run page itself. This is
 * the only result surface that works in EVERY `post_as` mode — including
 * `'none'`, where nothing is written to the pull request at all.
 */
export function jobSummaryFor(input: SummaryInput): string {
  const { agent, findings, blockers, gateTriggered, failOn } = input;
  const lines: string[] = [];

  lines.push(`## DevDigest — ${agent}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('**No findings.** The diff was reviewed and nothing was flagged.');
  } else {
    const counts = (['CRITICAL', 'WARNING', 'SUGGESTION'] as const)
      .map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }))
      .filter((c) => c.n > 0)
      .map((c) => `${SEVERITY_ICON[c.s]} ${c.n} ${c.s.toLowerCase()}`)
      .join(' · ');
    lines.push(`**${findings.length} findings** — ${counts}`);
  }

  lines.push('');
  lines.push(
    gateTriggered
      ? `> ❌ **Merge blocked.** ${blockers} finding(s) at or above \`fail_on: ${failOn}\`. ` +
          'This step exits non-zero by design — it is the gate working, not a runner failure.'
      : `> ✅ **Not blocking.** Gate is \`fail_on: ${failOn}\`.`,
  );

  if (findings.length > 0) {
    lines.push('');
    lines.push('| | Severity | Finding | Location |');
    lines.push('|---|---|---|---|');
    for (const f of findings) {
      // Pipes inside a cell would break the table; newlines would end the row.
      const title = f.title.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(
        `| ${SEVERITY_ICON[f.severity]} | ${f.severity} | ${title} | \`${f.file}:${f.start_line}\` |`,
      );
    }
  }

  lines.push('');
  lines.push(
    `PR #${input.prNumber} · ${(input.durationMs / 1000).toFixed(1)}s · ` +
      `$${input.costUsd.toFixed(4)} · posted as \`${input.postedTo}\``,
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/**
 * The last line in the log. Replaces a key=value dump that required decoding —
 * this states, in one sentence, what happened and why the step is about to fail.
 */
export function finalLineFor(input: {
  findings: number;
  blockers: number;
  gateTriggered: boolean;
  failOn: string;
}): string {
  if (input.gateTriggered) {
    return (
      `[agent-runner] BLOCKED: ${input.blockers} of ${input.findings} findings are at or above ` +
      `fail_on=${input.failOn}. Exiting non-zero to stop the merge.`
    );
  }
  if (input.findings === 0) return '[agent-runner] OK: no findings.';
  return (
    `[agent-runner] OK: ${input.findings} finding(s), none at or above fail_on=${input.failOn}. ` +
    'Not blocking.'
  );
}
