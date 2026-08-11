import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. L02 adds Skills (link/reorder), L06 adds Context (attached
 *  project documents) and Evals (regression cases + metrics), L08 adds CI
 *  (per-repository installations + the Export Wizard); later lessons add the
 *  rest.
 *
 *  A tab key is consumed in THREE places that must agree — `VALID_TABS` in
 *  `app/agents/[id]/page.tsx`, this array, and the render switch in
 *  `AgentEditor.tsx`. A disagreement silently falls back to `config` with no
 *  compile error (client/INSIGHTS.md, 2026-06-26). */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "Folder" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
];
