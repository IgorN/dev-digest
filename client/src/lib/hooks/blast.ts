/* hooks/blast.ts — React Query hooks for the Blast Radius map.
   Read the persisted per-PR BlastRadius (changed symbols + downstream
   callers/endpoints/crons + summary) and trigger a synchronous recompute.
   Modeled directly on hooks/intent.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/** Persisted BlastRadius for a PR, or `null` when it hasn't been computed yet
   (200 + null body — not a 404 — so this is a plain falsy check, not an
   error-boundary case, same contract as useIntent). */
export function useBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius | null>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** Recompute is an explicit user action (never automatic) — synchronous call
   that returns the fresh BlastRadius, written straight into ["blast", prId]. */
export function useRecomputeBlast(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BlastRadius>(`/pulls/${prId}/blast/recompute`, {}),
    onSuccess: (data) => qc.setQueryData(["blast", prId], data),
  });
}
