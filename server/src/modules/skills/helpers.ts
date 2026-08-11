import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { isMarkdownPath, isPathSafe } from '../context/helpers.js';
import type { SkillRow, SkillVersionRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * version-bump rule. No I/O.
 *
 * A skill is reusable across agents and carries only TEXT + configuration: its
 * `body` is the markdown block injected verbatim into an agent's prompt. It runs
 * nothing — there is no code path, no tool, no I/O behind a skill.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    context_documents: row.contextDocuments ?? null,
  };
}

/**
 * Validate + normalize an ordered set of attached context-document paths
 * (AC-19 save-time half; same rule as the agents module). Pure: rejects any
 * path failing the lexical `isPathSafe` guard or that isn't markdown (only
 * `.md` is attachable), and dedups repeats preserving the FIRST occurrence
 * (order is meaningful — it is the injection order at run time). Throws
 * `ValidationError` → 422.
 */
export function normalizeContextDocuments(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!isPathSafe(path)) {
      throw new ValidationError(`Unsafe context document path: ${path}`);
    }
    if (!isMarkdownPath(path)) {
      throw new ValidationError(`Only markdown (.md) documents can be attached: ${path}`);
    }
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    message: row.message ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill's prompt-affecting `body` relative to the
 * existing row. Only a body change bumps the version and snapshots
 * `skill_versions` — name/description/type/source are metadata and edit in place
 * (mirrors the agents rule, where toggling `enabled` doesn't version either).
 */
export function isBodyChange(
  existing: Pick<SkillRow, 'body'>,
  patch: { body?: string },
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}
