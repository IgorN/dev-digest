/* hooks/context.ts — React Query hooks for the Project Context folder (L06).
   Inventory + read-only preview of the active repo clone's markdown documents
   (specs/docs/insights), and the full-ordered-set attach endpoints for agents
   and skills. Attachment stores repo-relative PATHS, never document text. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextDocumentPreview, ContextInventory } from "@devdigest/shared";

/** Markdown documents under the repo clone's configured context roots.
 *  `has_clone: false` (empty items) is an expected state, not an error. */
export function useContextInventory(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-inventory", repoId],
    queryFn: () => api.get<ContextInventory>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** Current content of one inventoried document, read from the clone. */
export function useContextDocumentPreview(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-preview", repoId, path],
    queryFn: () =>
      api.get<ContextDocumentPreview>(
        `/repos/${repoId}/context/document?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** Replace the agent's ordered attached-document set (attach/detach/reorder in
 *  one call — mirrors `useSetAgentSkills`). Response is intentionally untyped:
 *  consumers rely on the invalidated `agent`/`agents` queries, not the body. */
export function useSetAgentContextDocuments(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<unknown>(`/agents/${agentId}/context-documents`, { paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** Replace the skill's ordered attached-document set (full set per change). */
export function useSetSkillContextDocuments(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<unknown>(`/skills/${skillId}/context-documents`, { paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
