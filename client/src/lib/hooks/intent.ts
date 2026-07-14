/* hooks/intent.ts — React Query hooks for the Intent Layer.
   Read the persisted per-PR Intent (summary + in-scope/out-of-scope) and
   trigger a synchronous recompute. Modeled on reviews.ts's usePrReviews (read)
   and conventions.ts's useExtractConventions (mutation writing straight into
   the read query's cache). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent } from "@devdigest/shared";

/** Persisted Intent for a PR, or `null` when it hasn't been computed yet
   (200 + null body — not a 404 — so this is a plain falsy check, not an
   error-boundary case). */
export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<Intent | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** Recompute is an explicit user action (never automatic) — synchronous call
   that returns the fresh Intent, written straight into ["intent", prId]. */
export function useRecomputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent/recompute`, {}),
    onSuccess: (data) => qc.setQueryData(["intent", prId], data),
  });
}
