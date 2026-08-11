/**
 * Re-run behaviour: a PR pushed to N times must not accumulate N blocking
 * reviews / N comments.
 *
 * The invariant that makes this safe: every run re-reviews the WHOLE current
 * diff, so the newest output is a complete picture, not a delta. Superseding the
 * previous one therefore cannot hide a finding that is still present — a finding
 * the developer has NOT fixed reappears in the new review on its own.
 */
import { describe, it, expect } from 'vitest';
import type { GitHubReviewPayload } from '@devdigest/shared';
import { postGithubReview, postPrComment, withMarker, type FetchLike } from './github.js';

const CTX = { owner: 'acme', repo: 'widgets', prNumber: 42 };
const MARKER = '<!-- devdigest:review -->';

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** Records calls and replies from a per-URL-substring routing table. */
function recorder(routes: { match: string; json: unknown }[] = []) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const route = routes.find((r) => url.includes(r.match));
    return new Response(JSON.stringify(route ? route.json : {}), { status: 200 });
  }) as unknown as FetchLike;
  return { fetchImpl, calls };
}

const PAYLOAD: GitHubReviewPayload = {
  body: '## Security Reviewer — Changes requested\n\n5 findings',
  event: 'REQUEST_CHANGES',
} as GitHubReviewPayload;

describe('withMarker', () => {
  it('tags the body so a later run can recognise its own output', () => {
    expect(withMarker('hello')).toBe(`${MARKER}\nhello`);
  });

  it('never double-tags an already-tagged body', () => {
    const once = withMarker('hello');
    expect(withMarker(once)).toBe(once);
  });
});

describe('postGithubReview — superseding', () => {
  it('dismisses our own earlier blocking review AFTER the replacement is posted', async () => {
    const { fetchImpl, calls } = recorder([
      {
        match: '/pulls/42/reviews?per_page',
        json: [
          { id: 111, node_id: 'PRR_111', body: `${MARKER}\nold`, state: 'CHANGES_REQUESTED' },
        ],
      },
    ]);

    await postGithubReview(CTX, 'tok', PAYLOAD, fetchImpl);

    // Posting first means the PR is never momentarily left without a blocker.
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PUT', 'POST']);
    expect(calls[2]!.url).toContain('/pulls/42/reviews/111/dismissals');
    expect(JSON.parse(calls[2]!.body!).event).toBe('DISMISS');

    // Dismissal alone leaves the full text in the timeline — the minimise is
    // what actually removes the noise the user complained about.
    expect(calls[3]!.url).toContain('/graphql');
    const gql = JSON.parse(calls[3]!.body!);
    expect(gql.query).toContain('minimizeComment');
    expect(gql.query).toContain('OUTDATED');
    expect(gql.variables.id).toBe('PRR_111');
  });

  it('leaves reviews that are not ours alone', async () => {
    const { fetchImpl, calls } = recorder([
      {
        match: '/pulls/42/reviews?per_page',
        json: [
          { id: 222, body: 'a human reviewer asked for changes', state: 'CHANGES_REQUESTED' },
          { id: 333, body: `${MARKER}\nours`, state: 'CHANGES_REQUESTED' },
        ],
      },
    ]);

    await postGithubReview(CTX, 'tok', PAYLOAD, fetchImpl);

    const dismissed = calls.filter((c) => c.method === 'PUT').map((c) => c.url);
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]).toContain('/reviews/333/dismissals');
  });

  it('leaves our own non-blocking (COMMENTED) reviews alone — they block nothing', async () => {
    const { fetchImpl, calls } = recorder([
      {
        match: '/pulls/42/reviews?per_page',
        json: [{ id: 444, body: `${MARKER}\napproved`, state: 'COMMENTED' }],
      },
    ]);

    await postGithubReview(CTX, 'tok', PAYLOAD, fetchImpl);

    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('still posts when the lookup fails — cleanup is cosmetic, the review is not', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (method === 'GET') throw new Error('network down');
      return new Response('{}', { status: 200 });
    }) as unknown as FetchLike;

    await expect(postGithubReview(CTX, 'tok', PAYLOAD, fetchImpl)).resolves.toBeUndefined();
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
  });
});

describe('postPrComment — sticky', () => {
  it('edits the existing DevDigest comment instead of appending another', async () => {
    const { fetchImpl, calls } = recorder([
      {
        match: '/issues/42/comments?per_page',
        json: [
          { id: 1, body: 'unrelated chatter' },
          { id: 2, body: `${MARKER}\nprevious result` },
        ],
      },
    ]);

    await postPrComment(CTX, 'tok', 'new result', fetchImpl);

    const write = calls.find((c) => c.method === 'PATCH' || c.method === 'POST')!;
    expect(write.method).toBe('PATCH');
    expect(write.url).toContain('/issues/comments/2');
    expect(JSON.parse(write.body!).body).toContain('new result');
  });

  it('creates the first comment when none of ours exists yet', async () => {
    const { fetchImpl, calls } = recorder([
      { match: '/issues/42/comments?per_page', json: [{ id: 1, body: 'unrelated' }] },
    ]);

    await postPrComment(CTX, 'tok', 'first result', fetchImpl);

    const write = calls.find((c) => c.method === 'PATCH' || c.method === 'POST')!;
    expect(write.method).toBe('POST');
    expect(write.url).toContain('/issues/42/comments');
  });
});

describe('legacy cleanup', () => {
  it('recognises reviews from a pre-marker runner build by their footer', async () => {
    // Without this, every repo that installed before the marker existed would
    // keep its accumulated blocking reviews forever.
    const { fetchImpl, calls } = recorder([
      {
        match: '/pulls/42/reviews?per_page',
        json: [
          { id: 901, body: 'old body\n\n_Posted via DevDigest._', state: 'CHANGES_REQUESTED' },
          { id: 902, body: `${MARKER}\nnew body`, state: 'CHANGES_REQUESTED' },
          { id: 903, body: 'someone else entirely', state: 'CHANGES_REQUESTED' },
        ],
      },
    ]);

    await postGithubReview(CTX, 'tok', PAYLOAD, fetchImpl);

    const dismissed = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => c.url.match(/reviews\/(\d+)\/dismissals/)![1]);
    expect(dismissed).toEqual(['901', '902']);
  });
});
