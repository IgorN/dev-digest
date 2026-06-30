import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';

/** Build a GitHub blob deep-link to a file (optionally a line range). */
export function githubBlobUrl(opts: {
  owner: string;
  name: string;
  ref: string;
  path: string;
  startLine?: number | null;
  endLine?: number | null;
}): string {
  const base = `https://github.com/${opts.owner}/${opts.name}/blob/${opts.ref}/${opts.path}`;
  if (opts.startLine == null) return base;
  const hash =
    opts.endLine && opts.endLine !== opts.startLine
      ? `#L${opts.startLine}-L${opts.endLine}`
      : `#L${opts.startLine}`;
  return `${base}${hash}`;
}

export interface RepoRef {
  owner: string;
  name: string;
  defaultBranch: string;
}

/** Map a persisted convention row to the public DTO, computing the GitHub link.
 *  `repo` is null when the repo ref can't be resolved → `evidence_url` is null
 *  (no broken github.com/unknown/unknown link). */
export function toConventionDto(row: ConventionRow, repo: RepoRef | null): ConventionCandidate {
  const path = row.evidencePath ?? '';
  return {
    id: row.id,
    repo_id: row.repoId ?? null,
    category: row.category ?? null,
    rule: row.rule,
    evidence_path: path,
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_start_line: row.evidenceStartLine ?? null,
    evidence_end_line: row.evidenceEndLine ?? null,
    evidence_url:
      path && repo
        ? githubBlobUrl({
            owner: repo.owner,
            name: repo.name,
            ref: repo.defaultBranch,
            path,
            startLine: row.evidenceStartLine,
            endLine: row.evidenceEndLine,
          })
        : null,
    confidence: row.confidence ?? 0,
    accepted: row.accepted ?? null,
  };
}
