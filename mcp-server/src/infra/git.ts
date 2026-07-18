/**
 * Infrastructure ring — the ONLY module in this vertical that spawns a
 * process. Reads the working tree's uncommitted diff via the real `git`
 * binary; no libgit2/isomorphic-git dependency needed for one command.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitClient } from '../ports/git.js';
import { GitUnavailableError } from '../ports/git.js';

const execFileAsync = promisify(execFile);

export class LocalGitClient implements GitClient {
  async workingTreeDiff(cwd: string): Promise<string> {
    try {
      // `git diff HEAD` covers staged + unstaged uncommitted changes (the
      // full "working tree" per --mode working) — a bare `git diff` alone
      // would miss anything already `git add`-ed.
      const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === 'ENOENT') {
        throw new GitUnavailableError('git is not installed or not on PATH.');
      }
      throw new GitUnavailableError(
        `git diff failed in ${cwd} — is this a git repository with a commit on HEAD? (${e.stderr?.trim() || e.message})`,
      );
    }
  }
}
