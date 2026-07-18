/**
 * Pure shaping (no I/O): turns repo-intel's internal `BlastResult` into the
 * public `BlastRadius` contract. All the actual graph work (symbols, callers,
 * endpoint/cron attribution, degraded-index detection) already happened
 * inside `container.repoIntel.getBlastRadius()` — this only groups, caps,
 * sorts, and excludes, per changed symbol.
 */
import type {
  BlastCallerRow,
  BlastResult,
} from '../repo-intel/types.js';
import type { BlastRadius, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import { MAX_CALLERS_PER_SYMBOL } from './constants.js';

export type ShapedBlastRadius = Omit<BlastRadius, 'summary'>;

/**
 * Group callers by the changed symbol they reach (`viaSymbol`), excluding any
 * caller row that lives in that symbol's OWN declaring file (a self-reference
 * isn't a downstream caller), then sort by `rank` (file_rank percentile;
 * `0` on the degraded/ripgrep path — sort is a no-op there) and cap at
 * `MAX_CALLERS_PER_SYMBOL` PER symbol (repo-intel's own internal cap of the
 * same value is applied globally across ALL changed symbols combined, so for
 * a PR with many changed symbols some symbols may already have lost callers
 * upstream — a known, accepted limitation of reading only via the facade).
 */
export function shapeBlastRadius(result: BlastResult): ShapedBlastRadius {
  const changed_symbols: ChangedSymbol[] = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const declaringFileBySymbol = new Map(result.changedSymbols.map((s) => [s.name, s.file]));
  const callersBySymbol = new Map<string, BlastCallerRow[]>();
  for (const c of result.callers) {
    if (declaringFileBySymbol.get(c.viaSymbol) === c.file) continue; // exclude the declaring file
    const arr = callersBySymbol.get(c.viaSymbol);
    if (arr) arr.push(c);
    else callersBySymbol.set(c.viaSymbol, [c]);
  }

  // No per-file attribution exists on the degraded/ripgrep path (factsByFile
  // is only computed on the persistent index) — fall back to the flat
  // endpoint union for every symbol rather than showing an empty list that
  // would read as "nothing affected" when the index simply couldn't tell us.
  const hasFacts = result.factsByFile != null;

  const downstream: DownstreamImpact[] = changed_symbols.map((sym) => {
    const callers = (callersBySymbol.get(sym.name) ?? [])
      .slice()
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_CALLERS_PER_SYMBOL);

    let endpoints_affected: string[];
    let crons_affected: string[];
    if (hasFacts) {
      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const file of new Set(callers.map((c) => c.file))) {
        const facts = result.factsByFile?.[file];
        facts?.endpoints.forEach((e) => endpoints.add(e));
        facts?.crons.forEach((c) => crons.add(c));
      }
      endpoints_affected = [...endpoints];
      crons_affected = [...crons];
    } else {
      endpoints_affected = [...new Set(result.impactedEndpoints)];
      crons_affected = [];
    }

    return {
      symbol: sym.name,
      callers: callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected,
      crons_affected,
    };
  });

  return {
    changed_symbols,
    downstream,
    degraded: result.degraded ?? false,
    degraded_reason: result.reason ?? null,
  };
}
