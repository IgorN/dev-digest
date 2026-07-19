/* hooks/onboarding.ts — React Query hooks for the repo Onboarding Tour.
   Read the persisted per-repo Onboarding (sections + generation/index metadata)
   and trigger a synchronous recompute.
   Modeled directly on hooks/blast.ts, but both endpoints wrap the payload in a
   `{ onboarding: … }` RESPONSE ENVELOPE, so the raw fetch result is mapped to
   `.onboarding` before it reaches the cache/consumers. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Onboarding } from "@devdigest/shared";

/** Persisted Onboarding for a repo, or `null` when it hasn't been generated yet
   (200 + `{ onboarding: null }` — not a 404 — so this is a plain falsy check,
   not an error-boundary case, same contract as useBlast). */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () =>
      api
        .get<{ onboarding: Onboarding | null }>(`/repos/${repoId}/onboarding`)
        .then((data) => data.onboarding),
    enabled: !!repoId,
  });
}

/** Recompute is an explicit user action (never automatic) — synchronous call
   that returns the fresh Onboarding, unwrapped from the envelope and written
   straight into ["onboarding", repoId]. */
export function useRecomputeOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ onboarding: Onboarding }>(
          `/repos/${repoId}/onboarding/recompute`,
          {}
        )
        .then((data) => data.onboarding),
    onSuccess: (onboarding) =>
      qc.setQueryData(["onboarding", repoId], onboarding),
  });
}
