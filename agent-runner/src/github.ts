import type { GitHubReviewPayload } from '@devdigest/shared';
import { RunnerError } from './errors.js';
import type { PrContext } from './context.js';

/**
 * Thin GitHub REST client built on the global `fetch` (Node 22) — NOT octokit.
 * `octokit` is not a declared dependency of this package (see
 * `agent-runner/package.json`) and the bundle must stay self-contained with no
 * `node_modules/@devdigest/*` (or other) runtime imports beyond what's
 * declared; hand-rolled REST calls keep the surface small and dependency-free.
 * `fetchImpl` is injectable so tests never hit the network.
 */

export type FetchLike = typeof fetch;

const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'devdigest-agent-runner';

function authHeaders(token: string, accept: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
}

/**
 * Invisible in rendered markdown, but present in the raw body — how a later run
 * recognises its own output. Matching on the bot user instead would also match
 * every OTHER Actions workflow posting to the same PR.
 *
 * ⚠️ THIS STRING IS A COMPATIBILITY CONTRACT — do not "tidy" it. It is matched
 * against bodies written by runner builds that are already committed inside
 * other people's repositories and may not be re-exported for months. Changing it
 * orphans every review posted so far: they stop being recognised as ours, stop
 * being superseded, and pile up again exactly as they did before this existed.
 * A new format needs a NEW marker matched ALONGSIDE this one, never instead.
 */
const MARKER = '<!-- devdigest:review -->';

/**
 * Reviews posted by a runner build older than the marker carry no marker at all,
 * so without this they would be invisible to the cleanup FOREVER — every repo
 * that installed before the upgrade would keep its existing pile of blocking
 * reviews. The footer comes from `reviewer-core`'s `toReviewPayload`
 * (`output/to-review.ts`) and has been in every posted body since the beginning.
 */
const LEGACY_SIGNATURE = 'Posted via DevDigest';

/** Ours — either the explicit marker, or the pre-marker footer. */
function isOwnBody(body: string): boolean {
  return body.includes(MARKER) || body.includes(LEGACY_SIGNATURE);
}

/** Prepend the ownership marker exactly once. */
export function withMarker(body: string): string {
  return body.startsWith(MARKER) ? body : `${MARKER}\n${body}`;
}

interface ReviewSummary {
  id: number;
  node_id?: string;
  body?: string;
  state?: string;
}

/** A superseded review: REST id for the dismissal, node id for the minimise. */
interface StaleReview {
  id: number;
  nodeId?: string;
}

interface CommentSummary {
  id: number;
  body?: string;
}

/**
 * Our own previously-submitted BLOCKING reviews.
 *
 * Only `CHANGES_REQUESTED` is collected: those are the ones that stack up as
 * "requested changes" on every push and keep blocking the PR. `COMMENTED`
 * reviews cannot be dismissed by the API at all, and they block nothing, so
 * they are deliberately left alone rather than chased with GraphQL.
 */
async function listOwnBlockingReviews(
  ctx: Pick<PrContext, 'owner' | 'repo' | 'prNumber'>,
  token: string,
  fetchImpl: FetchLike,
): Promise<StaleReview[]> {
  const url = `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}/reviews?per_page=100`;
  const res = await fetchImpl(url, { headers: authHeaders(token, 'application/vnd.github+json') });
  if (!res.ok) return [];
  const reviews = (await res.json()) as unknown;
  if (!Array.isArray(reviews)) return [];
  return (reviews as ReviewSummary[])
    .filter((r) => isOwnBody(r.body ?? '') && r.state === 'CHANGES_REQUESTED')
    .map((r) => ({ id: r.id, nodeId: r.node_id }));
}

/**
 * Collapse a superseded review's BODY in the conversation.
 *
 * Dismissing and minimising solve two different halves of the same complaint and
 * neither replaces the other: dismissal clears the blocking state but leaves the
 * full text sitting in the timeline, so a PR pushed to five times still reads as
 * five walls of findings. `minimizeComment` (GraphQL only — there is no REST
 * equivalent) folds it to "marked as outdated", which is what actually removes
 * the noise. Reversible in the UI, and the text stays readable behind the fold.
 */
async function minimizeReview(
  token: string,
  nodeId: string,
  fetchImpl: FetchLike,
): Promise<void> {
  await fetchImpl(`${GITHUB_API_BASE}/graphql`, {
    method: 'POST',
    headers: {
      ...authHeaders(token, 'application/vnd.github+json'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query:
        'mutation($id: ID!) { minimizeComment(input: {subjectId: $id, classifier: OUTDATED}) ' +
        '{ minimizedComment { isMinimized } } }',
      variables: { id: nodeId },
    }),
  });
}

/**
 * Retire superseded reviews: dismiss (stops blocking) AND minimise (stops
 * shouting). Dismissal alone was measured on a real PR to be insufficient — the
 * three older reviews correctly went to `DISMISSED` and every one of them still
 * rendered in full in the conversation, so the pile looked untouched.
 *
 * Neither step deletes anything: the text stays readable behind the fold and the
 * whole thing is reversible from the UI. Best-effort by design — losing this
 * cleanup must never fail a review that has already been posted successfully.
 */
async function dismissReviews(
  ctx: Pick<PrContext, 'owner' | 'repo' | 'prNumber'>,
  token: string,
  stale: StaleReview[],
  fetchImpl: FetchLike,
): Promise<void> {
  for (const { id, nodeId } of stale) {
    const url = `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}/reviews/${id}/dismissals`;
    try {
      await fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...authHeaders(token, 'application/vnd.github+json'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Superseded by a newer DevDigest review of the updated diff.',
          event: 'DISMISS',
        }),
      });
      if (nodeId) await minimizeReview(token, nodeId, fetchImpl);
    } catch {
      // Cosmetic cleanup only — swallow and move on.
    }
  }
}

/** Fetch the PR's unified diff via the GitHub API's diff media type. */
export async function fetchPrDiff(
  ctx: Pick<PrContext, 'owner' | 'repo' | 'prNumber'>,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}`;
  const res = await fetchImpl(url, {
    headers: authHeaders(token, 'application/vnd.github.v3.diff'),
  });
  if (!res.ok) {
    throw new RunnerError(
      `GitHub API error fetching PR diff (${url}): ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  return res.text();
}

/** Post a full review (body + event + optional inline comments) — `post_as: 'github_review'`. */
export async function postGithubReview(
  ctx: Pick<PrContext, 'owner' | 'repo' | 'prNumber'>,
  token: string,
  payload: GitHubReviewPayload,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}/reviews`;
  const post = (body: Record<string, unknown>) =>
    fetchImpl(url, {
      method: 'POST',
      headers: {
        ...authHeaders(token, 'application/vnd.github+json'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  // Snapshot the stale reviews BEFORE posting: after the new one lands it would
  // be in the list too, and the order matters for a second reason — posting
  // first means the PR is never left momentarily unblocked if this run fails.
  const stale = await listOwnBlockingReviews(ctx, token, fetchImpl).catch(() => [] as StaleReview[]);

  // GitHub's Actions token (`GITHUB_TOKEN`) — which the runner always posts with
  // — is NOT permitted to APPROVE a PR (422 "GitHub Actions is not permitted to
  // approve pull requests"). Downgrade an APPROVE event to COMMENT; the body
  // still renders the "Approved ✅" summary, we just don't submit the formal
  // approval GitHub would reject.
  const event = payload.event === 'APPROVE' ? 'COMMENT' : payload.event;
  const base = { body: withMarker(payload.body), event };
  const hasComments = !!payload.comments && payload.comments.length > 0;
  const withComments = hasComments
    ? { ...base, comments: payload.comments!.map((c) => ({ path: c.path, line: c.line, body: c.body })) }
    : base;

  let res = await post(withComments);

  // GitHub rejects the WHOLE review with a 422 if ANY inline comment targets a
  // file whose diff it can't resolve (e.g. "diff too large" for a huge file).
  // `stripIgnoredFiles` removes our own bundle, but a genuinely large file in a
  // normal PR could still trip this — so degrade gracefully to a body-only
  // review. Every finding is already in `payload.body`; only the inline anchors
  // are lost, which beats posting nothing.
  if (res.status === 422 && hasComments) {
    res = await post(base);
  }

  if (!res.ok) {
    throw new RunnerError(
      `GitHub API error posting review (${url}): ${res.status} ${await res.text().catch(() => '')}`,
    );
  }

  // The new review now carries the CURRENT state of the diff — a re-review of
  // the whole PR, not a delta — so the earlier ones are superseded rather than
  // merely older. Dismiss them only now that the replacement exists.
  await dismissReviews(ctx, token, stale, fetchImpl);
}

/**
 * Post the result as a plain issue comment — `post_as: 'pr_comment'`.
 *
 * STICKY: if a previous DevDigest comment exists it is EDITED in place rather
 * than a second one appended, so a PR pushed to ten times carries one comment
 * showing the current state instead of ten showing its history. GitHub keeps
 * the edit history behind the comment's "edited" menu, so nothing is destroyed.
 */
export async function postPrComment(
  ctx: Pick<PrContext, 'owner' | 'repo' | 'prNumber'>,
  token: string,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const listUrl = `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments?per_page=100`;
  const marked = withMarker(body);

  let existingId: number | null = null;
  try {
    const listRes = await fetchImpl(listUrl, {
      headers: authHeaders(token, 'application/vnd.github+json'),
    });
    if (listRes.ok) {
      const comments = (await listRes.json()) as unknown;
      if (Array.isArray(comments)) {
        // Last wins: if an earlier version of the runner left several, the
        // newest becomes the sticky one and older ones stay as history.
        const mine = (comments as CommentSummary[]).filter((c) => isOwnBody(c.body ?? ''));
        existingId = mine.length > 0 ? mine[mine.length - 1]!.id : null;
      }
    }
  } catch {
    // Lookup failed — fall through and post a fresh comment. A duplicate
    // comment is a far better outcome than losing the result entirely.
  }

  const url =
    existingId === null
      ? `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments`
      : `${GITHUB_API_BASE}/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existingId}`;

  const res = await fetchImpl(url, {
    method: existingId === null ? 'POST' : 'PATCH',
    headers: {
      ...authHeaders(token, 'application/vnd.github+json'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: marked }),
  });
  if (!res.ok) {
    throw new RunnerError(
      `GitHub API error posting PR comment (${url}): ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
}
