/* hooks/ci-runs.ts — React Query hooks for the CI Runs page (Export to CI).
   Two operations, deliberately kept distinct:

   - `useCiRuns` READS the local `ci_runs` table. It re-reads every 30 s while
     the page is mounted AND the tab is visible (`refetchIntervalInBackground:
     false`). This is what the design's "auto-refresh on" indicator describes —
     a local re-read, NOT a background poll of GitHub. Nothing here talks to
     GitHub.
   - `useRefreshCiRuns` is the ONLY path that pulls from GitHub: it triggers the
     server's ingest (list workflow runs → download artifacts → persist), and is
     invoked exclusively by the explicit Refresh control.

   Modeled on hooks/eval.ts (query-key + invalidate conventions). Slice B owns
   `hooks/ci-export.ts`; neither file touches `hooks/index.ts`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiIngestResult, CiRunsResponse } from "@devdigest/shared";

/** How often the page re-reads the LOCAL table while mounted and visible. */
export const CI_RUNS_REFETCH_MS = 30_000;

/** Filter chip selections. `null`/absent means "no constraint" (the "All …" chip). */
export interface CiRunsFilters {
  /** Date range in days back from now (the "Last N days" chip). */
  days?: number | null;
  agent_id?: string | null;
  repo?: string | null;
  status?: string | null;
  source?: string | null;
}

/** Serialize the active filters into a querystring; empty when nothing is set. */
export function ciRunsQueryString(filters: CiRunsFilters): string {
  const params = new URLSearchParams();
  if (filters.days != null) params.set("days", String(filters.days));
  if (filters.agent_id) params.set("agent_id", filters.agent_id);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * The workspace's CI runs plus the facets (agents, repos) the filter chips
 * need — one round trip, so the chip row never costs a second request.
 */
export function useCiRuns(filters: CiRunsFilters = {}) {
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => api.get<CiRunsResponse>(`/ci-runs${ciRunsQueryString(filters)}`),
    refetchInterval: CI_RUNS_REFETCH_MS,
    // Stop re-reading when the tab is hidden — an invisible page must not keep
    // a 30 s timer alive against the API.
    refetchIntervalInBackground: false,
  });
}

/**
 * The explicit Refresh: pulls workflow runs and their `devdigest-result.json`
 * artifacts from GitHub and persists them. Partial success is normal, so the
 * caller must read `CiIngestResult` rather than treat "resolved" as "all good".
 */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiIngestResult>("/ci-runs/refresh"),
    onSuccess: () => {
      // Broad key — every filter combination's cached page is now stale.
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
