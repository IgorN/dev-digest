import type { ContextInventory, DocumentInventoryItem } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../../db/rows.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ContextRepository } from './repository.js';
import {
  approxTokens,
  isMarkdownPath,
  isPathSafe,
  matchRoot,
  truncateToBytes,
} from './helpers.js';

/**
 * Project Context reader. Lists the `.md` documents of a repo's local clone
 * that sit under a configured context root (AppConfig.contextRoots, default
 * specs/docs/insights) and previews a single document. Fully deterministic —
 * clone reads via `container.git` only, zero LLM/model calls (AC-15), and
 * every read path is guarded lexically by `isPathSafe`, with symlink escapes
 * refused at the git adapter (realpath containment) and surfaced here as
 * unreadable — 404 on preview, token_estimate 0 in the inventory (AC-19).
 */

export interface DocumentPreview {
  repo_id: string;
  path: string;
  root: string;
  /** Current clone content, capped at `contextDocMaxBytes` (marker appended). */
  content: string;
  truncated: boolean;
  /** approxTokens over the returned (possibly truncated) content. */
  token_estimate: number;
}

export class ContextService {
  private repo: ContextRepository;

  constructor(private container: Container) {
    this.repo = new ContextRepository(container.db);
  }

  /**
   * The document inventory for a repo. A repo without a usable clone
   * (`clonePath` null — e.g. the seeded acme/payments-api — or a clone that
   * can't be listed) yields the empty `has_clone:false` envelope, never a 5xx
   * (AC-4). Returns undefined when the repo isn't in this workspace.
   */
  async inventory(workspaceId: string, repoId: string): Promise<ContextInventory | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    if (!repo.clonePath) return emptyInventory(repo.id);

    let tracked: string[];
    try {
      tracked = await this.container.git.listFiles(repo);
    } catch {
      // clonePath set but the clone is gone/unreadable — same empty state.
      return emptyInventory(repo.id);
    }

    const roots = this.container.config.contextRoots;
    const items: DocumentInventoryItem[] = [];
    for (const path of tracked) {
      if (!isMarkdownPath(path) || !isPathSafe(path)) continue;
      const root = matchRoot(path, roots);
      if (!root) continue;
      items.push({ path, root, token_estimate: await this.estimateTokens(repo, path) });
    }
    items.sort((a, b) => a.path.localeCompare(b.path));
    return { repo_id: repo.id, has_clone: true, count: items.length, items };
  }

  /**
   * One document's current content for the read-only preview pane (AC-2).
   * Refuses (422) any path that fails the lexical guard or is not a markdown
   * file under a configured root — no file outside the clone/root set is ever
   * read (AC-19). Returns undefined when the repo isn't in this workspace.
   */
  async preview(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<DocumentPreview | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    if (!isPathSafe(path)) {
      throw new ValidationError('Unsafe document path refused');
    }
    if (!isMarkdownPath(path)) {
      throw new ValidationError('Only markdown (.md) documents can be previewed');
    }
    const root = matchRoot(path, this.container.config.contextRoots);
    if (!root) {
      throw new ValidationError('Path is not under a configured context root');
    }
    if (!repo.clonePath) {
      throw new NotFoundError('Repository has no local clone');
    }

    let raw: string;
    try {
      raw = await this.container.git.readFile(repo, path);
    } catch {
      throw new NotFoundError('Document not found in the repo clone');
    }

    const { text, truncated } = truncateToBytes(raw, this.container.config.contextDocMaxBytes);
    return {
      repo_id: repo.id,
      path,
      root,
      content: text,
      truncated,
      token_estimate: approxTokens(text.length),
    };
  }

  /**
   * Deterministic estimate over CURRENT clone content, capped at
   * `contextDocMaxBytes` — the same cap injection truncates at, so the listed
   * estimate matches what a run would actually inject (and a pathological
   * multi-MB tracked .md can't blow the estimate up). 0 when unreadable
   * (missing, or a symlink escape refused by the git adapter).
   */
  private async estimateTokens(repo: RepoRow, path: string): Promise<number> {
    try {
      const content = await this.container.git.readFile(repo, path);
      const { text } = truncateToBytes(content, this.container.config.contextDocMaxBytes);
      return approxTokens(text.length);
    } catch {
      return 0;
    }
  }
}

function emptyInventory(repoId: string): ContextInventory {
  return { repo_id: repoId, has_clone: false, count: 0, items: [] };
}
