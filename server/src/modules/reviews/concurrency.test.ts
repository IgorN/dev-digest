import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runBounded } from './concurrency.js';
import { AGENT_FANOUT_CONCURRENCY } from './constants.js';

/**
 * Concurrency semantics of the agent fan-out (AC-1 – AC-4). Pure: no DB, no
 * LLM, no Fastify — that is the whole reason `runBounded` is its own function.
 */

/** A task that records when it starts/ends and how many peers were in flight. */
function instrument(ms: number) {
  const state = { inFlight: 0, maxInFlight: 0, completed: 0 };
  const intervals: { start: number; end: number }[] = [];
  const run = async () => {
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    const start = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    intervals.push({ start, end: Date.now() });
    state.inFlight -= 1;
    state.completed += 1;
  };
  return { state, intervals, run };
}

describe('runBounded', () => {
  it('never runs more than `limit` tasks simultaneously (AC-2)', async () => {
    const { state, run } = instrument(30);
    await runBounded([1, 2, 3, 4, 5, 6], 4, run);

    expect(state.maxInFlight).toBe(4);
    expect(state.maxInFlight).not.toBe(5);
    expect(state.completed).toBe(6);
  });

  it('starts tasks concurrently — 6×50ms at limit 4 runs in waves, not serially (AC-1)', async () => {
    const { intervals, run } = instrument(50);
    const started = Date.now();
    await runBounded([1, 2, 3, 4, 5, 6], 4, run);
    const wallClock = Date.now() - started;

    // Serial would be ~300ms; two waves is ~100ms. Generous ceiling so a slow
    // CI box still proves "not six serial waits".
    expect(wallClock).toBeLessThan(250);

    // The first four intervals overlap each other (a serial run cannot).
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const [a, b, c, d] = sorted as [typeof sorted[0], typeof sorted[0], typeof sorted[0], typeof sorted[0]];
    for (const other of [b, c, d]) {
      expect(other.start).toBeLessThan(a.end);
    }
  });

  it('isolates failures — one rejecting task does not stop the other five (AC-4)', async () => {
    const completed: number[] = [];
    await expect(
      runBounded([1, 2, 3, 4, 5, 6], 4, async (n) => {
        await new Promise((r) => setTimeout(r, 10));
        if (n === 3) throw new Error('agent 3 exploded');
        completed.push(n);
      }),
    ).resolves.toBeUndefined();

    expect(completed.sort((x, y) => x - y)).toEqual([1, 2, 4, 5, 6]);
  });

  it('resolves immediately on an empty item list', async () => {
    let calls = 0;
    await runBounded([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('runs everything even when the limit exceeds the item count', async () => {
    const { state, run } = instrument(5);
    await runBounded([1, 2], 4, run);
    expect(state.completed).toBe(2);
    expect(state.maxInFlight).toBe(2);
  });
});

describe('AGENT_FANOUT_CONCURRENCY', () => {
  it('defaults to 4 (AC-3)', () => {
    expect(AGENT_FANOUT_CONCURRENCY).toBe(4);
  });

  it('is referenced by the executor rather than inlined (AC-2, AC-3)', () => {
    const source = readFileSync(new URL('./run-executor.ts', import.meta.url), 'utf8');
    expect(source).toContain('runBounded(jobs, AGENT_FANOUT_CONCURRENCY');
    // No bare numeric limit smuggled into the fan-out call.
    expect(source).not.toMatch(/runBounded\(jobs,\s*\d/);
  });
});
