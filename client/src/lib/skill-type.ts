import type { SkillSource, SkillType } from "@devdigest/shared";

/**
 * Skill-type → colour token, shared by the Skills page, the side preview, and the
 * Agent Editor's Skills tab so a type reads the same everywhere. Security is the
 * loud one (red); rubric/convention/custom are calmer.
 */
export const SKILL_TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit, #f87171)",
  custom: "var(--text-secondary)",
};

export function skillTypeColor(type: SkillType): string {
  return SKILL_TYPE_COLOR[type] ?? "var(--text-secondary)";
}

/** Selectable skill types in the create/edit forms. */
export const SKILL_TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Default type for a new skill. */
export const DEFAULT_SKILL_TYPE: SkillType = "custom";

/** Human label for a skill's provenance (shown in the preview). `community` =
 *  imported from outside — foreign instructions, treated with care. */
export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  manual: "Authored here",
  imported_url: "Imported from URL",
  extracted: "Extracted from repo",
  community: "Imported (community)",
};
