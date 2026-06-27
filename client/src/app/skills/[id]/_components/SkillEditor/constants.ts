import type { IconName } from "@devdigest/ui";

/** Skill editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill editor tabs: edit config, preview the rendered body, browse version
 *  history, and see which agents use the skill. */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "GitBranch" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
];

/** Tab keys accepted from the `?tab=` query (anything else falls back to config). */
export const VALID_SKILL_TABS = TABS.map((t) => t.key);
