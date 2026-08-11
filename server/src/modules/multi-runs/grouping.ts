import type { MultiRunGroup, MultiRunVerdictCell } from '@devdigest/shared';
import { CELL_RATIONALE_MAX_CHARS, SEVERITY_RANK, SUCCESSFUL_RUN_STATUS } from './constants.js';
import type { GroupingAgent, GroupingFinding } from './types.js';

/**
 * Cross-agent grouping — the multi-run module's DOMAIN CORE.
 *
 * PURE and ZERO-I/O by contract: no `container`, no Drizzle, no `process.env`,
 * no clock, no randomness. Everything it needs arrives in its arguments, which
 * is what makes every acceptance criterion below directly unit-testable without
 * a database (see `grouping.test.ts`).
 *
 * Co-location is same-file + overlapping line range and NOTHING else — no text
 * heuristic, no embedding, no LLM judge (spec Non-goals).
 */

// ---------------------------------------------------------------------------
// Co-location
// ---------------------------------------------------------------------------

/**
 * Closed-integer-interval overlap. Re-implemented locally on purpose: the same
 * rule lives in `eval/scoring.ts` (`rangesOverlap`, lines 23-29) but is
 * module-private and not exported, and it in turn faithfully mirrors
 * `reviewer-core`'s private `rangeIntersects` — which this feature must not
 * modify. Exporting it across module boundaries (or reaching into
 * reviewer-core) would couple two unrelated features, so the four-line rule is
 * duplicated with this citation instead.
 *
 * Adjacent, non-overlapping ranges (`[1,5]`/`[6,10]`) do NOT overlap; a single
 * shared boundary line (`[1,5]`/`[5,10]`) DOES (AC-6).
 */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/** Byte-wise string order — locale-independent, so output is reproducible. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A finding plus the index of the agent that produced it (the agent order). */
interface Entry {
  finding: GroupingFinding;
  agentIndex: number;
}

/**
 * "Which finding speaks for this set" — highest severity, ties broken by
 * highest confidence, then lowest start line, then the agent's position in the
 * multi-run's agent order, then finding id. Fully total, so the result is
 * identical across repeated runs AND across shuffled input orderings (AC-9).
 */
function compareEntries(a: Entry, b: Entry): number {
  return (
    severityRank(b.finding.severity) - severityRank(a.finding.severity) ||
    b.finding.confidence - a.finding.confidence ||
    a.finding.start_line - b.finding.start_line ||
    a.agentIndex - b.agentIndex ||
    compareStrings(a.finding.id, b.finding.id)
  );
}

/** Best (per `compareEntries`) entry of a non-empty list. */
function bestEntry(entries: Entry[]): Entry {
  return entries.reduce((best, e) => (compareEntries(e, best) < 0 ? e : best), entries[0]!);
}

/** Collapse markdown/multi-line rationale into ONE clipped display line. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CELL_RATIONALE_MAX_CHARS
    ? `${flat.slice(0, CELL_RATIONALE_MAX_CHARS - 1).trimEnd()}…`
    : flat;
}

// ---------------------------------------------------------------------------
// Connected components (union-find)
// ---------------------------------------------------------------------------

/**
 * Group a single file's entries into the CONNECTED COMPONENTS of the overlap
 * relation — co-location is applied transitively, so A`[10,20]`, B`[18,30]` and
 * C`[28,40]` land in ONE group even though A and C do not overlap (AC-7).
 */
function connectedComponents(entries: Entry[]): Entry[][] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    // Path compression keeps this near-linear on pathological chains.
    let cur = i;
    while (parent[cur] !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const x = entries[i]!.finding;
      const y = entries[j]!.finding;
      if (rangesOverlap(x.start_line, x.end_line, y.start_line, y.end_line)) union(i, j);
    }
  }

  const buckets = new Map<number, Entry[]>();
  for (let i = 0; i < entries.length; i += 1) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(entries[i]!);
    else buckets.set(root, [entries[i]!]);
  }
  return [...buckets.values()];
}

// ---------------------------------------------------------------------------
// Verdict cells
// ---------------------------------------------------------------------------

/**
 * One cell per PARTICIPATING agent, in the multi-run's agent order — including
 * agents that contributed nothing to this group (AC-10).
 *
 * Verdict precedence, in this order:
 *   1. the agent's run did NOT reach the successful terminal status (failed,
 *      cancelled, still running, or a legacy null) → `no_result` — a state that
 *      is explicitly distinct from `did_not_flag` and must NEVER be reported as
 *      agreement (AC-13);
 *   2. it did, and it contributed ≥1 finding here → `flagged`, carrying the
 *      severity of its OWN highest-severity finding in this group plus a
 *      one-line rationale from that same finding (AC-11);
 *   3. it did, and it contributed nothing → `did_not_flag` (AC-12).
 *
 * (1) is checked before (2) because AC-13 is written as an unconditional WHERE
 * over the run's status, and its observable is negative ("never `did_not_flag`
 * for a failed agent"). In practice the two branches are disjoint: the executor
 * persists a review + findings BEFORE marking the run `done`, so a run carrying
 * findings has always reached `done` by the time it is terminal.
 */
function buildCells(agents: GroupingAgent[], groupFindingIds: Set<string>): MultiRunVerdictCell[] {
  return agents.map((agent, agentIndex) => {
    if (agent.status !== SUCCESSFUL_RUN_STATUS) {
      return { agent_id: agent.cellKey, verdict: 'no_result' as const };
    }
    const mine = agent.findings
      .filter((f) => groupFindingIds.has(f.id))
      .map((finding) => ({ finding, agentIndex }));
    if (mine.length === 0) {
      return { agent_id: agent.cellKey, verdict: 'did_not_flag' as const };
    }
    // Two findings from the SAME agent in one group collapse to ONE cell,
    // speaking with its highest-severity finding (AC-11, edge case).
    const { finding } = bestEntry(mine);
    return {
      agent_id: agent.cellKey,
      verdict: 'flagged' as const,
      severity: finding.severity,
      rationale: oneLine(finding.rationale),
      finding_id: finding.id,
    };
  });
}

/**
 * A group is a CONFLICT when the agents that ACTUALLY FLAGGED the location
 * disagree about how bad it is: ≥2 distinct severities among `flagged` cells.
 * `did_not_flag` and `no_result` are both excluded from the comparison.
 *
 * So `{CRITICAL, WARNING}` → conflict; `{W, W, W}` → not;
 * `{CRITICAL, did not flag, did not flag}` → NOT a conflict; `{W, no result}` → not.
 *
 * Silence is deliberately NOT a verdict here. Counting `did_not_flag` as one
 * made every group a conflict in practice — with specialised agents, a finding
 * is normally raised by exactly one of them and missed by the rest, which says
 * "the others weren't looking at this dimension", not "the others disagree".
 * That rendered `Show only conflicts` a no-op (it filtered nothing on real
 * runs). Restricting the comparison to the agents that spoke makes the toggle
 * surface what it promises: the same line judged CRITICAL by one reviewer and
 * SUGGESTION by another. A location flagged by a single agent is a unique
 * find — still shown in the block, just not counted as a disagreement.
 */
function isConflict(cells: MultiRunVerdictCell[]): boolean {
  const severities = new Set<string>();
  for (const cell of cells) {
    if (cell.verdict !== 'flagged') continue;
    severities.add(String(cell.severity));
  }
  return severities.size >= 2;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute the multi-run's cross-agent groups.
 *
 * One group per code location where at least one participating agent produced a
 * finding, ordered by `file` ascending then by the group's minimum
 * `start_line` ascending (AC-15). A multi-run whose agents produced no finding
 * at all yields `[]` — the client renders its own explicit empty state (AC-58).
 *
 * @param agents participating agents in the multi-run's authoritative order.
 */
export function computeGroups(agents: GroupingAgent[]): MultiRunGroup[] {
  const byFile = new Map<string, Entry[]>();
  agents.forEach((agent, agentIndex) => {
    for (const finding of agent.findings) {
      const bucket = byFile.get(finding.file);
      const entry: Entry = { finding, agentIndex };
      if (bucket) bucket.push(entry);
      else byFile.set(finding.file, [entry]);
    }
  });

  const groups: MultiRunGroup[] = [];
  for (const [file, entries] of byFile) {
    for (const component of connectedComponents(entries)) {
      // The group's location is its file plus the MINIMUM start line across
      // its findings (AC-8).
      const line = Math.min(...component.map((e) => e.finding.start_line));
      const label = bestEntry(component).finding.title;
      const ids = new Set(component.map((e) => e.finding.id));
      const cells = buildCells(agents, ids);
      groups.push({ file, line, label, conflict: isConflict(cells), cells });
    }
  }

  groups.sort(
    (a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.label, b.label),
  );
  return groups;
}
