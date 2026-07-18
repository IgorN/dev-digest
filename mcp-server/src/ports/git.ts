/**
 * Ports ring — the interface the `review-working-tree` use-case depends on
 * for reading local git state (DIP, mirrors `devdigest-api.ts`). No concrete
 * process-spawning is named here; `infra/git.ts` implements it.
 */
export interface GitClient {
  /** Unified diff of the working tree vs HEAD (staged + unstaged, uncommitted
   *  changes) for the repo at `cwd`. Empty string when there's nothing to diff. */
  workingTreeDiff(cwd: string): Promise<string>;
}

/** Thrown when `cwd` isn't inside a git repo, or `git` itself isn't on PATH. */
export class GitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitUnavailableError';
  }
}
