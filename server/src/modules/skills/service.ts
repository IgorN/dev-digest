import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillType,
  SkillUsage,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
import { buildImportPreview } from './import.js';

/**
 * Skills service. Business logic for the Skills page + Skill Editor.
 *
 * A skill = name + description + type + markdown `body`, reusable across agents.
 * It carries text + configuration only; nothing executes. The `body` is the
 * block injected into an agent's prompt (see reviewer-core assemblePrompt). A
 * body change is versioned via `skill_versions` (repository).
 */

export { toSkillDto } from './helpers.js';

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
  /** "What changed" note saved with the new version (only when body changes). */
  version_message?: string | null;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      type: input.type,
      // Skills authored in the UI are `manual`; imports pass their own source.
      source: input.source ?? 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
      ...(patch.version_message !== undefined ? { versionMessage: patch.version_message } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill (and its versions / agent links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body-snapshot history for a skill, newest first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (route → 404), so version
   * history can't be read across tenants.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /** Which agents use this skill (Stats tab). Undefined when the skill isn't in
   *  this workspace (route → 404). */
  async usage(workspaceId: string, id: string): Promise<SkillUsage | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const agents = await this.repo.agentsUsing(workspaceId, id);
    return { agent_count: agents.length, agents };
  }

  /**
   * Parse an uploaded markdown file or zip archive into a non-persisted preview.
   * Pure parsing — nothing is saved and no archive code is executed; the client
   * shows the preview and only then calls `create`. Throws on unreadable input.
   */
  parseImport(filename: string, bytes: Buffer): SkillImportPreview {
    return buildImportPreview(filename, bytes);
  }
}
