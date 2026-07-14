/* hooks/smart-diff.ts — React Query hook for Smart Diff: the PR's diff
   pre-classified by risk role (core/wiring/boilerplate) with each file's
   finding line numbers, recomputed on every call server-side (no LLM, no
   cache — see server smart-diff/service.ts). Modeled on intent.ts's
   useIntent (read-only, same enabled/queryKey shape) — no mutation needed
   here (there's no "recompute" action; every GET is already fresh). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/** Smart Diff for a PR: risk-grouped files + finding_lines + split_suggestion. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
