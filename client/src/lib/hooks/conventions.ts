/* hooks/conventions.ts — React Query hooks for the Conventions Extractor (L03).
   Scan a repo for house-conventions, accept/reject/edit candidates, and merge
   accepted ones into the `repo-conventions` skill. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export interface ConventionsList {
  candidates: ConventionCandidate[];
  sample_count: number | null;
  scanned_at: string | null;
}

export interface ExtractResult extends ConventionsList {
  proposed: number;
  verified: number;
}

export interface ConventionSkillDraft {
  name: string;
  description: string;
  type: "convention";
  body: string;
  count: number;
}

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsList>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractResult>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: { accepted?: boolean | null; rule?: string; category?: string | null };
}

export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionsList>(["conventions", repoId], (prev) =>
        prev
          ? { ...prev, candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)) }
          : prev,
      );
    },
  });
}

export function useBulkConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accepted: boolean) =>
      api.post<ConventionsList>(`/repos/${repoId}/conventions/bulk`, { accepted }),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

/** Merged `repo-conventions` skill draft from accepted candidates (modal pre-fill).
 *  `enabled` is toggled when the create-skill modal opens. */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["conventions-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
    // The draft reflects the CURRENT accepted set — never serve a stale cache when
    // the modal re-opens after more accept/reject. Always refetch, don't retain.
    staleTime: 0,
    gcTime: 0,
  });
}
