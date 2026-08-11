/* hooks/ci-export.ts — React Query hooks for the agent's CI tab and the Export
   Wizard (Export to CI).

   Three server routes back this file:
     GET  /agents/:id/ci-installations   → the CI tab's rows
     POST /agents/:id/export-ci          → `action:"files"` generates (no commit),
                                           `action:"open_pr"` commits + opens the PR
     POST /agents/:id/export-ci/zip      → the same file set as a zip, zero GitHub calls

   `ci-runs.ts` (the CI Runs page) is a SEPARATE file owned by another slice, and
   neither file is re-exported from `hooks/index.ts` — import the module directly. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiInstallation } from "@devdigest/shared";

/** Wizard-supplied part of the export request — `action` is set by the hook. */
export type CiExportRequest = Omit<CiExportInputBody, "action">;

export interface CiExportArgs {
  agentId: string;
  input: CiExportRequest;
}

/** The agent's CI installations (one row per repository), with the server's
    derived status / last-activity / policy-drift fields already resolved. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** Generate the file set WITHOUT touching GitHub — the Preview step, re-fired
    whenever a Configure option changes so the workflow always matches the config. */
export function useGenerateCiExport() {
  return useMutation({
    mutationFn: ({ agentId, input }: CiExportArgs) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, { ...input, action: "files" }),
  });
}

/** Commit the file set onto `devdigest/ci` and resolve-or-open the pull request. */
export function useInstallCiExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: CiExportArgs) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, { ...input, action: "open_pr" }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/** The degraded manual path: download the same generated file set as a zip.
    Contacts the zip route and nothing else — no commit, no PR, no GitHub call. */
export function useDownloadCiZip() {
  return useMutation({
    mutationFn: async ({ agentId, input }: CiExportArgs) => {
      const blob = await api.blob(`/agents/${agentId}/export-ci/zip`, input);
      triggerBrowserDownload(blob, `devdigest-ci-${agentId}.zip`);
      return blob;
    },
  });
}

/** Save a Blob to disk via a transient object URL. Kept here (not in a
    component) so the wizard never touches the DOM directly. */
function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
