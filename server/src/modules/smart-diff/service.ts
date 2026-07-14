import type {
  ProposedSplit,
  SmartDiff,
  SmartDiffFile,
  SmartDiffGroup,
  SmartDiffRole,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository, type ReviewRow, type FindingRow } from '../reviews/repository.js';
import { latestReviewsPerAgent } from '../pulls/status.js';
import { classifyFile } from './classify.js';
import { SMART_DIFF_TOO_BIG_LINES } from './constants.js';

/** Response group order (`[core, wiring, boilerplate]`); `groupByRole` omits
 *  any group that ends up with zero files. */
const GROUP_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** Synthetic top-level-directory name for a file with no `/` (a root file). */
const ROOT_SPLIT_NAME = '(root)';

type ClassifiedFile = { role: SmartDiffRole; file: SmartDiffFile };

/**
 * Smart Diff service — classifies a PR's current files by risk role and
 * recomposes them with the LATEST already-computed review findings. Zero LLM
 * calls: the reviewer's model call already happened when the review ran;
 * this only re-reads and re-groups what's already in Postgres (Design
 * decision C — recomputed on every read, no caching table, unlike the other
 * `PrBrief` building blocks).
 *
 * `get()` is traceable as three DB reads via `this.repo` (`getPull`,
 * `getPrFiles`, `reviewsForPull`) followed by pure-function composition
 * (`resolveFindingLines`, `classifyAndGroup`, `groupByRole`,
 * `computeSplitSuggestion`, `bucketFindingLines`, `proposeSplits`) — nothing
 * else. Mirrors every other module's `constructor(private container: Container)`
 * shape (cross-module `ReviewRepository` import is an established pattern;
 * see `intent/service.ts`) even though, unlike `IntentService`, this class
 * never reaches for anything off `container` beyond `.db` at construction
 * time — kept for consistency with the rest of the codebase rather than as a
 * signal that a future method might need more (no LLM call is the feature's
 * whole point, and always will be).
 */
export class SmartDiffService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /** The SmartDiff for a PR's current files. Recomputed on every call. */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, reviewsNewestFirst] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.repo.reviewsForPull(prId),
    ]);

    const findingLinesByPath = resolveFindingLines(
      reviewsNewestFirst,
      files.map((f) => f.path),
    );
    const classified = classifyAndGroup(files, findingLinesByPath);

    return {
      groups: groupByRole(classified),
      split_suggestion: computeSplitSuggestion(classified),
    };
  }
}

/**
 * Findings resolution (Design decision E): the LATEST review per agent —
 * `kind === 'review'` filtered BEFORE the dedup (mirrors the SQL-level
 * `eq(t.reviews.kind, 'review')` filter `pulls/routes.ts` applies for its own
 * FINDINGS-column rollup; filtering after dedup would let a newer,
 * finding-less `'summary'` row for an agent incorrectly supersede an older
 * `'review'` row's real findings) — with dismissed findings dropped. Buckets
 * the survivors by file into `finding_lines`.
 */
function resolveFindingLines(
  reviewsNewestFirst: {
    review: Pick<ReviewRow, 'id' | 'agentId' | 'runId' | 'kind'>;
    findings: FindingRow[];
  }[],
  currentPaths: string[],
): Map<string, number[]> {
  const reviewFindingsOnly = reviewsNewestFirst
    .filter((r) => r.review.kind === 'review')
    .map((r) => ({
      id: r.review.id,
      agentId: r.review.agentId,
      runId: r.review.runId,
      findings: r.findings,
    }));
  const survivingFindings = latestReviewsPerAgent(reviewFindingsOnly)
    .flatMap((r) => r.findings)
    .filter((f) => f.dismissedAt == null);
  return bucketFindingLines(survivingFindings, new Set(currentPaths));
}

/**
 * Bucket surviving findings by file into `finding_lines` (Design decision F:
 * one entry per surviving finding = its `start_line`, not deduped, not the
 * full `[start_line, end_line]` range — so `finding_lines.length` equals the
 * true finding count for the client's "N findings" badge). A finding whose
 * `file` doesn't match any of the PR's CURRENT paths (stale/renamed) is
 * dropped, not an error. Sorted ascending per file so a badge click's
 * `finding_lines[0]` is the file's topmost finding, not an arbitrary
 * DB-fetch order.
 */
function bucketFindingLines(
  findings: Pick<FindingRow, 'file' | 'startLine'>[],
  currentPaths: Set<string>,
): Map<string, number[]> {
  const byPath = new Map<string, number[]>();
  for (const finding of findings) {
    if (!currentPaths.has(finding.file)) continue;
    const lines = byPath.get(finding.file) ?? [];
    lines.push(finding.startLine);
    byPath.set(finding.file, lines);
  }
  for (const lines of byPath.values()) lines.sort((a, b) => a - b);
  return byPath;
}

/**
 * Classify every file and attach its `finding_lines`. `pseudocode_summary`
 * is intentionally never set (Design decision A — leaving the `.nullish()`
 * field unset is the whole point: no new LLM call for this feature).
 */
function classifyAndGroup(
  files: { path: string; additions: number; deletions: number }[],
  findingLinesByPath: Map<string, number[]>,
): ClassifiedFile[] {
  return files.map((f) => ({
    role: classifyFile(f.path),
    file: {
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: findingLinesByPath.get(f.path) ?? [],
    },
  }));
}

/** Groups classified files into `[core, wiring, boilerplate]` order, omitting
 *  any group with zero files. */
function groupByRole(classified: ClassifiedFile[]): SmartDiffGroup[] {
  return GROUP_ORDER.map((role) => ({
    role,
    files: classified.filter((c) => c.role === role).map((c) => c.file),
  })).filter((group) => group.files.length > 0);
}

/**
 * `split_suggestion` (Design decision G): `total_lines` sums
 * `(additions + deletions)` over `core` + `wiring` files ONLY — boilerplate
 * is excluded so a huge lockfile diff can never trip "this PR is too big".
 * `proposed_splits` is only computed when actually too big (Design decision
 * G: "a simple, deterministic heuristic... no acceptance criterion pins the
 * exact algorithm").
 */
function computeSplitSuggestion(classified: ClassifiedFile[]): SmartDiff['split_suggestion'] {
  const nonBoilerplate = classified.filter((c) => c.role !== 'boilerplate');
  const totalLines = nonBoilerplate.reduce(
    (sum, c) => sum + c.file.additions + c.file.deletions,
    0,
  );
  const tooBig = totalLines > SMART_DIFF_TOO_BIG_LINES;
  return {
    too_big: tooBig,
    total_lines: totalLines,
    proposed_splits: tooBig ? proposeSplits(nonBoilerplate.map((c) => c.file.path)) : [],
  };
}

/**
 * Simple, deterministic split heuristic: group non-boilerplate files by
 * their top-level directory (a file with no `/` falls into a synthetic
 * `(root)` group). `Map` preserves first-seen insertion order, so the output
 * order is stable for a given input — no randomness.
 */
function proposeSplits(paths: string[]): ProposedSplit[] {
  const byTopLevelDir = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.indexOf('/');
    const dir = slash === -1 ? ROOT_SPLIT_NAME : path.slice(0, slash);
    const bucket = byTopLevelDir.get(dir) ?? [];
    bucket.push(path);
    byTopLevelDir.set(dir, bucket);
  }
  return [...byTopLevelDir.entries()].map(([name, groupFiles]) => ({
    name,
    files: groupFiles,
  }));
}
