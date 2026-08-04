import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { AppError } from '../../platform/errors.js';

/**
 * INFRASTRUCTURE — the ONLY filesystem reader in the ci module.
 *
 * Reads the ncc-built agent-runner output so `generation.ts` can stay a pure,
 * zero-I/O function that takes the bytes as an argument.
 */

/** The literal command a user must run when the bundle is absent (AC-15). */
export const RUNNER_BUILD_COMMAND = 'cd agent-runner && pnpm build';

/**
 * Typed failure for every "the runner bundle is not usable" case. Distinct from
 * a generic 5xx so the wizard can render an actionable message rather than
 * "something went wrong".
 */
export class RunnerBundleError extends AppError {
  constructor(message: string, details?: unknown) {
    super('runner_bundle_unavailable', message, 422, details);
    this.name = 'RunnerBundleError';
  }
}

export interface RunnerFile {
  /** Path RELATIVE to the build-output directory, POSIX-separated. */
  path: string;
  /** Verbatim UTF-8 contents. ncc emits JavaScript text; never rewritten. */
  contents: string;
}

/** Every file under `dir`, recursively, as POSIX-relative paths. */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
    // Symlinks / sockets / fifos are deliberately ignored: ncc emits neither,
    // and following one would let a link outside the build directory ride along.
  }
  return out;
}

/**
 * Read EVERY file the runner build emitted, byte-for-byte (AC-13, AC-14).
 *
 * Three failure modes, all fatal to the whole export:
 *  - the directory is missing or unreadable → the bundle was never built
 *    (`agent-runner/dist/` is git-ignored, so this is the DEFAULT state of a
 *    fresh clone, not a rare accident) — AC-15;
 *  - the directory is empty → same class of error — AC-15;
 *  - ANY single file cannot be read → the whole read fails and NOTHING is
 *    returned — AC-15a. `Promise.all` (never `allSettled`) is load-bearing here:
 *    a pull request carrying the entry module without its lazily-imported chunk
 *    installs cleanly, reviews as correct, merges, and only then crashes at
 *    runtime inside someone else's CI. Shipping nothing beats shipping most.
 */
export async function readRunnerBundle(dir: string): Promise<RunnerFile[]> {
  let names: string[];
  try {
    // Never a hard-coded file list: the chunk's name (`300.index.js` today) is
    // build-generated and changes between builds (AC-14).
    names = await walk(dir);
  } catch (err) {
    throw new RunnerBundleError(
      `The CI runner bundle has not been built. Expected the build output at ${dir}. ` +
        `Run \`${RUNNER_BUILD_COMMAND}\` and export again.`,
      { dir, cause: (err as Error).message },
    );
  }

  if (names.length === 0) {
    throw new RunnerBundleError(
      `The CI runner bundle directory ${dir} is empty. ` +
        `Run \`${RUNNER_BUILD_COMMAND}\` and export again.`,
      { dir },
    );
  }

  try {
    return await Promise.all(
      names.sort().map(async (name) => ({
        path: name,
        contents: await readFile(join(dir, ...name.split(posix.sep)), 'utf8'),
      })),
    );
  } catch (err) {
    throw new RunnerBundleError(
      `The CI runner bundle at ${dir} could not be read in full, so nothing was exported. ` +
        `Run \`${RUNNER_BUILD_COMMAND}\` and export again.`,
      { dir, cause: (err as Error).message },
    );
  }
}

/** Total UTF-8 byte size of a bundle — surfaced to the wizard's placeholder. */
export function bundleBytes(files: RunnerFile[]): number {
  return files.reduce((n, f) => n + Buffer.byteLength(f.contents, 'utf8'), 0);
}
