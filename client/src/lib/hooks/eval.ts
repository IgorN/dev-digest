/* hooks/eval.ts — React Query hooks for the Eval Pipeline (L06): eval cases
   (create/read/update/delete, incl. "turn a finding into a case"), running an
   agent's case set as one batch, and the per-agent + workspace-wide dashboards.
   Modeled on hooks/blast.ts (query-key + setQueryData conventions) and
   hooks/reviews.ts's useFindingAction (path-param-not-body id convention). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentVersion,
  EvalCase,
  EvalCaseInput,
  EvalCaseWithLatestRun,
  EvalDashboard,
  EvalRunBatchInput,
  EvalRunBatchResponse,
  EvalWorkspaceDashboard,
} from "@devdigest/shared";

// ---- Eval cases (owner-scoped list + single-case CRUD) --------------------

/** An owner's (agent's) eval case set — each case carries its most recent
   persisted run (if any), so the Evals tab's pass/fail status survives a
   page reload instead of resetting to "never run". */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCaseWithLatestRun[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** One eval case by id (case editor). */
export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", caseId],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

/** Create payload — owner_kind/owner_id are resolved server-side from the path. */
export type CreateEvalCaseInput = Omit<EvalCaseInput, "owner_kind" | "owner_id">;

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEvalCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: (data) => {
      qc.setQueryData(["eval-case", data.id], data);
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

/** Update payload — same case fields (all optional/partial) plus a
   non-persisted `run_on_save` flag the server interprets as "run this one
   case immediately after saving". */
export type UpdateEvalCaseInput = Partial<Omit<EvalCaseInput, "owner_kind" | "owner_id">> & {
  run_on_save?: boolean;
};

export function useUpdateEvalCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEvalCaseInput) => api.put<EvalCase>(`/eval-cases/${caseId}`, input),
    onSuccess: (data) => {
      qc.setQueryData(["eval-case", caseId], data);
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

export function useDeleteEvalCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["eval-case", caseId] });
      // caseId doesn't carry its owner's agentId, so invalidate every
      // eval-cases list broadly rather than guessing one — cheap, infrequent.
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
    },
  });
}

/** One-click "turn this finding into an eval case" — mirrors useFindingAction's
   convention of passing the target id as the mutate argument (path param),
   not duplicated into the body. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.setQueryData(["eval-case", data.id], data);
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

// ---- Running an agent's case set as one batch ------------------------------

/** Run every (or a `case_ids`-targeted subset of) an agent's eval cases through
   the agent's CURRENT config. Response carries both the per-case results and
   the refreshed agent dashboard, so both caches are seeded directly. */
export function useRunEvalBatch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalRunBatchInput = {}) =>
      api.post<EvalRunBatchResponse>(`/agents/${agentId}/eval-runs`, input),
    onSuccess: (data) => {
      qc.setQueryData(["agent-eval-dashboard", agentId], data.dashboard);
      // per-case pass/fail + "last run" status shown in the case list/editor.
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

// ---- Dashboards -------------------------------------------------------------

/** Per-agent Evals tab / drill-in dashboard (tiles + trend + recent runs). */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/** Workspace-wide Eval Dashboard index — one summary per agent + a global
   recent-runs table across every agent. */
export function useEvalWorkspaceDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval-dashboard"),
  });
}

/** "Run all agents" — a sequential server-side loop over every enabled agent
   with ≥1 eval case. Response is the refreshed workspace dashboard. */
export function useRunAllAgentEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalWorkspaceDashboard>("/eval-dashboard/run-all"),
    onSuccess: (data) => {
      qc.setQueryData(["eval-dashboard"], data);
      // per-agent dashboards may now be stale (many agents just ran); drop the
      // cached ones broadly rather than one invalidate call per agent id.
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
    },
  });
}

// ---- Agent version snapshot (Compare-runs modal's system-prompt diff) -----

/**
 * Snapshot of an agent's config at a past version — `GET
 * /agents/:id/versions/:version`. No existing hook covers this (grepped
 * `hooks/agents.ts` and `hooks/skills.ts`: `useSkillVersions` only lists
 * version summaries, it doesn't fetch one full snapshot).
 */
export function useAgentVersion(
  agentId: string | null | undefined,
  version: number | null | undefined,
) {
  return useQuery({
    queryKey: ["agent-version", agentId, version],
    queryFn: () => api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`),
    enabled: !!agentId && version != null,
  });
}
