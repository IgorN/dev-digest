/* hooks/why-risk-brief.ts — React Query hooks for the Why + Risk Brief.
   Read the persisted per-PR WhyRiskBrief (what/why/risk_level/risks/
   review_focus) and trigger a synchronous recompute.
   Modeled directly on hooks/blast.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { WhyRiskBrief } from "@devdigest/shared";

/** Persisted WhyRiskBrief for a PR, or `null` when it hasn't been computed
   yet (200 + null body — not a 404 — so this is a plain falsy check, not an
   error-boundary case, same contract as useBlast/useIntent). */
export function useWhyRiskBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["why-risk-brief", prId],
    queryFn: () => api.get<WhyRiskBrief | null>(`/pulls/${prId}/why-risk-brief`),
    enabled: !!prId,
  });
}

/** Recompute is an explicit user action (never automatic) — synchronous call
   that returns the fresh WhyRiskBrief, written straight into
   ["why-risk-brief", prId]. */
export function useRecomputeWhyRiskBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WhyRiskBrief>(`/pulls/${prId}/why-risk-brief/recompute`, {}),
    onSuccess: (data) => qc.setQueryData(["why-risk-brief", prId], data),
  });
}
