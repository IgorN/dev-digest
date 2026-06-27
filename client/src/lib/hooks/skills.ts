/* hooks/skills.ts — React Query hooks for the Skills page, Skill Editor, and the
   Agent Editor's Skills tab (link/reorder). Skills are reusable, text-only review
   rules shared across agents. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillType,
  SkillUsage,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
  /** Optional "what changed" note — saved with the new version when body changes. */
  versionMessage?: string;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch, versionMessage }: UpdateSkillInput) =>
      api.put<Skill>(`/skills/${id}`, {
        ...patch,
        ...(versionMessage ? { version_message: versionMessage } : {}),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // a body edit appends a new version snapshot — refresh the Versions tab.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** Body-snapshot history for a skill (Versions tab). */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Which agents use this skill (Stats tab). */
export function useSkillUsage(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-usage", id],
    queryFn: () => api.get<SkillUsage>(`/skills/${id}/usage`),
    enabled: !!id,
  });
}

/** Parse an uploaded markdown/zip into a preview — does NOT persist anything. */
export function useImportSkill() {
  return useMutation({
    mutationFn: (input: { filename: string; content_base64: string }) =>
      api.post<SkillImportPreview>("/skills/import", input),
  });
}

// ---- Agent ⇄ skill links (Agent Editor's Skills tab) --------------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace the agent's ordered skill set (attach/detach/reorder in one call). */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-skills", agentId], data);
      // a skill set change re-snapshots the agent's version on the next config save;
      // keep the agents list fresh so skill counts update.
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
