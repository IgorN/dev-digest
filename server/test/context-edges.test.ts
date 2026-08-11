import { describe, it, expect } from 'vitest';
import { truncateToBytes, approxTokens } from '../src/modules/context/helpers.js';
import { TRUNCATION_MARKER } from '../src/modules/context/constants.js';
import { RunTrace } from '@devdigest/shared';

/**
 * Project Context — unit-lane edge cases NOT covered by
 * context-helpers.test.ts / reviews-context-assembly.test.ts:
 *   - truncateToBytes boundary behaviour around multi-byte code points exactly
 *     at / just past the byte cap (the continuation-byte walk-back loop),
 *   - RunTrace.parse round-trip of the NEW `specs_injected` field (persisted
 *     trace JSON: every status variant, explicit null, invalid status rejected;
 *     the OLD shape without the field is already covered in contracts.test.ts).
 */

describe('truncateToBytes — multi-byte boundary edges (AC-18)', () => {
  it('cap landing exactly ON a code-point boundary cuts clean, no walk-back', () => {
    // '€' = 3 UTF-8 bytes; '€€€' = 9 bytes; cap 6 lands exactly between the
    // 2nd and 3rd euro (buf[6] is a LEAD byte, so the loop must not walk back).
    const { text, truncated } = truncateToBytes('€€€', 6);
    expect(truncated).toBe(true);
    expect(text).toBe('€€' + TRUNCATION_MARKER);
    expect(text).not.toContain('�');
  });

  it('multi-byte content whose byte length EQUALS the cap is returned unchanged', () => {
    expect(truncateToBytes('€€', 6)).toEqual({ text: '€€', truncated: false });
  });

  it('never splits a 4-byte astral code point (surrogate pair in UTF-16)', () => {
    // '😀' = 4 UTF-8 bytes (2 UTF-16 code units); '😀😀' = 8 bytes. Cap 5 lands
    // mid-second-emoji → walk back 5→4 onto the first emoji's end.
    const { text, truncated } = truncateToBytes('😀😀', 5);
    expect(truncated).toBe(true);
    expect(text).toBe('😀' + TRUNCATION_MARKER);
    expect(text).not.toContain('�');
    // tokens (used by the callers) are over UTF-16 length of the kept text
    expect(approxTokens(text.length)).toBe(Math.ceil(('😀'.length + TRUNCATION_MARKER.length) / 4));
  });

  it('cap smaller than the first code point walks back to empty text + marker', () => {
    const { text, truncated } = truncateToBytes('€xyz', 2);
    expect(truncated).toBe(true);
    expect(text).toBe(TRUNCATION_MARKER);
  });

  it('cap 0 on non-empty content yields marker only; empty content stays untouched', () => {
    expect(truncateToBytes('abc', 0)).toEqual({ text: TRUNCATION_MARKER, truncated: true });
    expect(truncateToBytes('', 0)).toEqual({ text: '', truncated: false });
  });
});

describe('RunTrace.parse — specs_injected round-trip (persisted trace JSON)', () => {
  /** Minimal valid persisted trace, shaped like run-executor's success path. */
  const baseTrace = {
    config: { agent: 'A', version: '1', provider: 'openai', model: 'gpt-4.1', pr: 7, source: 'local' },
    stats: { duration_ms: 10, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed', cost_usd: null },
    prompt_assembly: { system: 's', skills: null, memory: null, specs: null, user: 'u' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [] as string[],
    log: [],
  };

  it('round-trips all three status variants', () => {
    const specsInjected = [
      { path: 'docs/a.md', tokens: 12, status: 'injected' },
      { path: 'docs/big.md', tokens: 16384, status: 'truncated' },
      { path: 'docs/gone.md', tokens: 0, status: 'skipped_missing' },
    ];
    const parsed = RunTrace.parse({
      ...baseTrace,
      specs_read: ['docs/a.md', 'docs/big.md'],
      specs_injected: specsInjected,
    });
    expect(parsed.specs_injected).toEqual(specsInjected);
    expect(parsed.specs_read).toEqual(['docs/a.md', 'docs/big.md']);
  });

  it('explicit specs_injected: null parses (the failure-path trace writes null)', () => {
    // traceFromBuffer persists `specs_injected: null` — the field must stay
    // .nullish(), not just .optional(), or every failed run's trace breaks.
    const parsed = RunTrace.parse({ ...baseTrace, specs_injected: null });
    expect(parsed.specs_injected).toBeNull();
  });

  it('rejects an unknown status and a non-integer token count', () => {
    expect(() =>
      RunTrace.parse({
        ...baseTrace,
        specs_injected: [{ path: 'a.md', tokens: 1, status: 'exploded' }],
      }),
    ).toThrow();
    expect(() =>
      RunTrace.parse({
        ...baseTrace,
        specs_injected: [{ path: 'a.md', tokens: 1.5, status: 'injected' }],
      }),
    ).toThrow();
  });
});
