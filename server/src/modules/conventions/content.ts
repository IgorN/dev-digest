import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../../db/rows.js';

/**
 * The extractor's code source. Reads real repo files from the local git CLONE
 * when the repo is synced (works for any cloned repo, no indexing needed), and
 * falls back to `code_chunks` for the seeded demo repo (which has no clone).
 * Sampling is fully code-driven (no model): config files + the top-ranked source
 * files via `repoIntel.getConventionSamples`, falling back to a shallow-path
 * heuristic when the repo has no rank index yet.
 */

const CONFIG_RE =
  /(^|\/)(\.eslintrc|eslint\.config|tsconfig|\.prettierrc|prettier\.config|package\.json|\.editorconfig|biome\.json)/i;
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rb|java|kt|rs|php|cs|scala)$/i;
const JUNK_RE =
  /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|coverage|vendor|\.turbo|__snapshots__)\//i;

/** A file worth feeding the model: source or config, not generated/junk. */
function isSampleable(path: string): boolean {
  if (JUNK_RE.test(path)) return false;
  if (path.endsWith('.d.ts') || /\.min\.[cm]?js$/i.test(path)) return false;
  return SOURCE_RE.test(path) || CONFIG_RE.test(path);
}

export class ConventionsContent {
  constructor(
    private db: Db,
    private container: Container,
  ) {}

  /**
   * All sampleable file paths for the repo. Prefers the local clone (any synced
   * repo); falls back to the paths stored in `code_chunks` (demo / indexed repo).
   */
  async availablePaths(repo: RepoRow): Promise<string[]> {
    if (repo.clonePath) {
      try {
        const tracked = await this.container.git.listFiles(repo);
        const usable = tracked.filter(isSampleable);
        if (usable.length > 0) return usable;
      } catch {
        // clone missing/unreadable — fall through to indexed content
      }
    }
    const rows = await this.db
      .select({ path: t.codeChunks.path })
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repo.id), eq(t.codeChunks.source, 'code')));
    return [...new Set(rows.map((r) => r.path))];
  }

  /**
   * Pick the files to feed the model: configs first (they encode style rules),
   * then the top-ranked source files, then the shallowest remaining ones — capped
   * at `n` source files (+ configs).
   */
  async pickSamples(repoId: string, allPaths: string[], n: number): Promise<string[]> {
    const configs = allPaths.filter((p) => CONFIG_RE.test(p));

    let ranked: string[] = [];
    try {
      ranked = (await this.container.repoIntel.getConventionSamples(repoId, n)).filter((p) =>
        allPaths.includes(p),
      );
    } catch {
      ranked = [];
    }

    const rest = allPaths
      .filter((p) => !configs.includes(p) && !ranked.includes(p))
      // shallower paths first (closer to src root = more representative), then a–z
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

    const source = [...ranked, ...rest].slice(0, n);
    return [...new Set([...configs, ...source])];
  }

  /** Load content for the sampled paths: from the clone, else from code_chunks. */
  async loadContent(repo: RepoRow, paths: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (repo.clonePath) {
      for (const p of paths) {
        try {
          const content = await this.container.git.readFile(repo, p);
          if (content) map.set(p, content);
        } catch {
          // skip unreadable file
        }
      }
      if (map.size > 0) return map;
    }

    const wanted = new Set(paths);
    const rows = await this.db
      .select({ path: t.codeChunks.path, content: t.codeChunks.content })
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repo.id), eq(t.codeChunks.source, 'code')));
    for (const r of rows) {
      if (!wanted.has(r.path)) continue;
      const prev = map.get(r.path);
      if (!prev || r.content.length > prev.length) map.set(r.path, r.content);
    }
    return map;
  }
}
