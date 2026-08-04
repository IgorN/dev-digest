/**
 * `statusFromRun` — the ingested run's terminal status.
 *
 * Regression guard for a reporting bug: the status used to be derived from the
 * finding count alone, so a run whose gate fired — red check on GitHub, merge
 * stopped — was ingested as a green `succeeded` and contradicted the very job
 * the table row links to.
 */
import { describe, it, expect } from 'vitest';
import { statusFromRun } from './helpers.js';

describe('statusFromRun', () => {
  it('reports a clean review as no_findings regardless of conclusion', () => {
    expect(statusFromRun(0, 'success')).toBe('no_findings');
    // A job that failed for its own reasons still found nothing to report.
    expect(statusFromRun(0, 'failure')).toBe('no_findings');
  });

  it('reports findings that did NOT trip the gate as succeeded', () => {
    // `ci_fail_on: never`, or findings below the exported threshold.
    expect(statusFromRun(5, 'success')).toBe('succeeded');
  });

  it('reports a gate-triggered run as blocked, never as succeeded', () => {
    const status = statusFromRun(5, 'failure');
    expect(status).toBe('blocked');
    // The whole point of the fix: this row must not read green while the
    // linked GitHub check is red.
    expect(status).not.toBe('succeeded');
  });

  it('keeps blocked distinct from failed so a working gate is not read as a broken runner', () => {
    expect(statusFromRun(1, 'failure')).toBe('blocked');
    expect(statusFromRun(1, 'failure')).not.toBe('failed');
  });

  it('treats a missing conclusion as not-blocking rather than guessing', () => {
    expect(statusFromRun(3, null)).toBe('succeeded');
  });
});
