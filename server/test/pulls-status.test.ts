/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  latestReviewsPerAgent,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('latestReviewsPerAgent', () => {
  it('keeps only the newest review per agent — a re-run supersedes the old one', () => {
    // newest-first: Security re-ran (r3) after r1; Perf ran once (r2).
    const kept = latestReviewsPerAgent([
      { id: 'r3', agentId: 'security', runId: 'run3' },
      { id: 'r2', agentId: 'perf', runId: 'run2' },
      { id: 'r1', agentId: 'security', runId: 'run1' },
    ]);
    expect(kept.map((r) => r.id)).toEqual(['r3', 'r2']); // r1 (stale Security) dropped
  });

  it('covers every distinct agent that ran', () => {
    const kept = latestReviewsPerAgent([
      { id: 'a', agentId: 'security', runId: null },
      { id: 'b', agentId: 'perf', runId: null },
      { id: 'c', agentId: 'general', runId: null },
    ]);
    expect(kept.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats reviews with no agentId as independent (falls back to runId)', () => {
    const kept = latestReviewsPerAgent([
      { id: 'r2', agentId: null, runId: 'run2' },
      { id: 'r1', agentId: null, runId: 'run1' },
    ]);
    expect(kept.map((r) => r.id)).toEqual(['r2', 'r1']); // distinct runIds → both kept
  });
});
