/* helpers.ts — pure formatting, delta, and diff logic for CompareRunsModal.
   No I/O, no React — safe to unit test directly. Mirrors (rather than
   imports) EvalAgentDrillIn/helpers.ts's delta conventions — this codebase's
   established pattern of colocated per-component helper duplication (see
   client/INSIGHTS.md, 2026-07-18, on ContextTab). */
import type { AgentVersionConfig, EvalTrendPoint } from "@devdigest/shared";
import type { UpdateAgentInput } from "@/lib/hooks/agents";
import { formatCost } from "@/lib/cost";

/** "vN" version tag — identical convention to EvalAgentDrillIn's formatVersion. */
export function formatVersion(version: number): string {
  return `v${version}`;
}

/** Round-to-percent formatter, e.g. 0.873 -> "87%". */
export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Order the two selected batches older -> newer by `ran_at`. Defensive:
 * `EvalAgentDrillIn`'s selection order is "most-recently-checked", not
 * chronological, so this component re-sorts rather than trusting call-site
 * order. Returns `[undefined, undefined]` for anything but exactly 2 runs
 * (the caller renders nothing in that case).
 */
export function sortByRanAt(runs: EvalTrendPoint[]): [EvalTrendPoint | undefined, EvalTrendPoint | undefined] {
  if (runs.length !== 2) return [undefined, undefined];
  const sorted = [...runs].sort((a, b) => new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime());
  return [sorted[0], sorted[1]];
}

export type DeltaDirection = "up" | "down" | "flat";

export function deltaDirection(delta: number): DeltaDirection {
  if (delta > 1e-9) return "up";
  if (delta < -1e-9) return "down";
  return "flat";
}

/** Metric delta color — up (improvement) = green, down (regression) = red,
   flat = muted. Never color-alone: an Arrow/Slash icon + the formatted delta
   text always accompany it (this codebase's accessibility convention, see
   EvalAgentDrillIn/helpers.ts). */
export function metricDeltaColor(delta: number): string {
  const dir = deltaDirection(delta);
  return dir === "flat" ? "var(--text-muted)" : dir === "up" ? "var(--ok)" : "var(--crit)";
}

/** Cost delta color is the INVERSE of the metric convention — a cost
   INCREASE is the regression (red), a decrease is the improvement (green). */
export function costDeltaColor(delta: number): string {
  const dir = deltaDirection(delta);
  return dir === "flat" ? "var(--text-muted)" : dir === "up" ? "var(--crit)" : "var(--ok)";
}

/** "+5pts" / "-2pts" / "0pt" for fraction-scale (0..1) metric deltas. */
export function formatDeltaPoints(delta: number): string {
  const pts = Math.round(delta * 100);
  const sign = pts > 0 ? "+" : pts < 0 ? "-" : "";
  return `${sign}${Math.abs(pts)}pt${Math.abs(pts) === 1 ? "" : "s"}`;
}

/** "+$0.002" / "-$0.002" / "$0.00" cost delta, reusing the shared `formatCost`
   formatter (client/src/lib/cost.ts) for the magnitude so it never diverges
   from every other cost display in the app. */
export function formatCostDelta(delta: number): string {
  const dir = deltaDirection(delta);
  const sign = dir === "up" ? "+" : dir === "down" ? "-" : "";
  return `${sign}${formatCost(Math.abs(delta))}`;
}

export type DiffLineKind = "added" | "removed" | "unchanged";
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Minimal line-level diff (LCS-based, not a full Myers algorithm — this
 * modal's inputs are prompt-sized text, not source files, so O(n*m) is fine
 * and this is simpler/more testable than pulling in a diff library). Splits
 * both texts on "\n" and walks the LCS table to emit an ordered sequence of
 * added/removed/unchanged lines. No existing diff-computation utility was
 * found to reuse — the PR diff viewer (`components/diff-viewer/`) only
 * RENDERS an already-server-computed unified diff, it doesn't compute one
 * from two arbitrary strings.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: "unchanged", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      result.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: "removed", text: a[i]! });
    i++;
  }
  while (j < m) {
    result.push({ kind: "added", text: b[j]! });
    j++;
  }
  return result;
}

/**
 * Reshape a snapshotted `AgentVersionConfig` into the `PUT /agents/:id`
 * update-mutation's exact payload shape. NOT a 1:1 field copy: `useUpdateAgent`
 * / the server's `UpdateAgentBody` (server/src/modules/agents/routes.ts) only
 * accept `provider/model/system_prompt/output_schema/strategy/ci_fail_on/
 * repo_intel` — `AgentVersionConfig.skills` (linked skill ids) and
 * `.context_documents` have NO field in that patch shape; they're set via
 * separate endpoints (`POST /agents/:id/skills`, `POST
 * /agents/:id/context-documents`) that this modal does not call. Promoting an
 * older version therefore restores its provider/model/prompt/schema/strategy/
 * gate/repo-intel flag exactly, but does NOT revert linked skills or attached
 * context documents to that version's snapshot — a real, scope-bounded
 * limitation (flagged, not silently fixed) rather than a new versioning
 * primitive this task was asked to introduce.
 */
export function toUpdatePatch(config: AgentVersionConfig): UpdateAgentInput["patch"] {
  return {
    provider: config.provider,
    model: config.model,
    system_prompt: config.system_prompt,
    output_schema: config.output_schema,
    strategy: config.strategy,
    ci_fail_on: config.ci_fail_on,
    repo_intel: config.repo_intel,
  };
}
