/* multi-runs.ts — TanStack Query hooks for Multi-Agent Review.

   Three read surfaces:
     - useMultiRun          one multi-run as a single document (the result page)
     - useLatestMultiRun    "what is the most recent multi-run for this scope"
     - useAgentEstimates    per-agent time/cost averages for the pre-run estimate

   Polling is bounded (R12/AC-38): the result document refreshes only while at
   least one of its runs is still non-terminal, and stops entirely once they all
   settle. */
import { useQuery } from "@tanstack/react-query";
import type {
  AgentRunEstimate,
  LatestMultiRunResponse,
  MultiRunDocument,
} from "@devdigest/shared";
import { api } from "../api";

/** Run statuses that mean "this lane is finished, nothing more will arrive". */
export const TERMINAL_RUN_STATUSES = ["done", "failed", "cancelled"] as const;

/** Poll cadence while any lane is still in flight. */
export const MULTI_RUN_POLL_MS = 2000;

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * `false` once every lane has settled, so the page stops hitting the API;
 * `MULTI_RUN_POLL_MS` while any lane is still running. A document that has not
 * loaded yet also polls, so a page opened mid-fan-out starts refreshing.
 */
export function multiRunRefetchInterval(
  data: MultiRunDocument | undefined,
): number | false {
  if (!data) return MULTI_RUN_POLL_MS;
  if (data.agents.length === 0) return false;
  return data.agents.every((a) => isTerminalRunStatus(a.status)) ? false : MULTI_RUN_POLL_MS;
}

/** One multi-run as a single document. */
export function useMultiRun(multiRunId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-run", multiRunId],
    queryFn: () => api.get<MultiRunDocument>(`/multi-runs/${multiRunId}`),
    enabled: !!multiRunId,
    refetchInterval: (query) => multiRunRefetchInterval(query.state.data),
  });
}

/** Exactly one scope key is used at a time: a repository or a single PR. */
export interface LatestMultiRunScope {
  repoId?: string | null;
  prId?: string | null;
}

/**
 * The most recent multi-run for a scope.
 *
 * The server answers 2xx with `{ multi_run: null }` when the scope has none —
 * so "no multi-run yet" is a SUCCESSFUL result, not an error (AC-22b).
 * Consumers must branch on `data.multi_run`, never on `isError`.
 */
export function useLatestMultiRun(scope: LatestMultiRunScope) {
  const repoId = scope.repoId ?? null;
  const prId = scope.prId ?? null;
  // Exactly one scope value — never both, never neither.
  const enabled = (repoId === null) !== (prId === null);
  const qs = repoId !== null ? `repoId=${repoId}` : `prId=${prId}`;
  return useQuery({
    queryKey: ["multi-run-latest", repoId, prId],
    queryFn: () => api.get<LatestMultiRunResponse>(`/multi-runs/latest?${qs}`),
    enabled,
  });
}

/** Per-agent averages over completed runs; agents with no history report nulls. */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentRunEstimate[]>("/agent-estimates"),
  });
}
