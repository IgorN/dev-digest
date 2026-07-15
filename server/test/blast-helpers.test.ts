import { describe, it, expect } from 'vitest';
import { shapeBlastRadius } from '../src/modules/blast/helpers.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/blast/constants.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

function caller(over: Partial<BlastResult['callers'][number]> = {}) {
  return { file: 'src/caller.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 10, rank: 0, ...over };
}

describe('shapeBlastRadius', () => {
  it('groups callers per changed symbol, excludes the declaring file', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/lib/rate-limit.ts', name: 'rateLimit', kind: 'function' }],
      callers: [
        caller({ file: 'src/api/public/items.ts', line: 23, rank: 0.9 }),
        // Same file as the declaration — must be excluded.
        caller({ file: 'src/lib/rate-limit.ts', line: 5, rank: 0.5 }),
      ],
      impactedEndpoints: ['GET /api/public/items'],
      factsByFile: { 'src/api/public/items.ts': { endpoints: ['GET /api/public/items'], crons: [] } },
      degraded: false,
    };

    const shaped = shapeBlastRadius(result);

    expect(shaped.changed_symbols).toEqual([{ name: 'rateLimit', file: 'src/lib/rate-limit.ts', kind: 'function' }]);
    expect(shaped.downstream).toHaveLength(1);
    expect(shaped.downstream[0]).toEqual({
      symbol: 'rateLimit',
      callers: [{ name: 'handler', file: 'src/api/public/items.ts', line: 23 }],
      endpoints_affected: ['GET /api/public/items'],
      crons_affected: [],
    });
    expect(shaped.degraded).toBe(false);
    expect(shaped.degraded_reason).toBeNull();
  });

  it('caps callers at MAX_CALLERS_PER_SYMBOL, sorted by rank descending', () => {
    const callers = Array.from({ length: 30 }, (_, i) =>
      caller({ file: `src/caller-${i}.ts`, line: i, rank: i }),
    );
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/lib/rate-limit.ts', name: 'rateLimit', kind: 'function' }],
      callers,
      impactedEndpoints: [],
      degraded: false,
    };

    const shaped = shapeBlastRadius(result);

    expect(shaped.downstream[0]!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // Highest rank (29) first.
    expect(shaped.downstream[0]!.callers[0]!.file).toBe('src/caller-29.ts');
    expect(shaped.downstream[0]!.callers.at(-1)!.file).toBe('src/caller-10.ts');
  });

  it('falls back to the flat endpoint union when factsByFile is absent (degraded path)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/lib/rate-limit.ts', name: 'rateLimit', kind: 'function' }],
      callers: [caller({ file: 'src/api/public/items.ts' })],
      impactedEndpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
      // no factsByFile — the ripgrep/degraded path never sets it
      degraded: true,
      reason: 'index_partial',
    };

    const shaped = shapeBlastRadius(result);

    expect(shaped.degraded).toBe(true);
    expect(shaped.degraded_reason).toBe('index_partial');
    expect(shaped.downstream[0]!.endpoints_affected).toEqual([
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(shaped.downstream[0]!.crons_affected).toEqual([]);
  });

  it('returns an empty downstream list when there are no changed symbols', () => {
    const result: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };
    const shaped = shapeBlastRadius(result);
    expect(shaped.changed_symbols).toEqual([]);
    expect(shaped.downstream).toEqual([]);
  });

  it('defaults degraded to false and reason to null when repo-intel omits them', () => {
    const result: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    };
    const shaped = shapeBlastRadius(result);
    expect(shaped.degraded).toBe(false);
    expect(shaped.degraded_reason).toBeNull();
  });
});
