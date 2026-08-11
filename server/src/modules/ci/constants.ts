/**
 * Export-to-CI literals. Every path the export writes and every bound the
 * ingest respects lives here — nothing in this module hard-codes them inline.
 */

/** Never the default branch: the export always lands on its own branch (AC-28). */
export const CI_BRANCH = 'devdigest/ci';

/** The generated workflow's path inside the target repository. */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/**
 * The workflow FILENAME (not the path) — GitHub's Actions API addresses a
 * workflow by its file name when listing runs.
 */
export const WORKFLOW_FILE = 'devdigest-review.yml';

export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const RUNNER_DIR = '.devdigest/runner';

/** Artifact name the generated workflow uploads under, and the file inside it. */
export const ARTIFACT_NAME = 'devdigest-result';
export const ARTIFACT_FILE = 'devdigest-result.json';

/**
 * Hard cap on a downloaded artifact (AC-41). The archive arrives from someone
 * else's CI, so this bounds BOTH the download and the decompression.
 */
export const ARTIFACT_MAX_BYTES = 256 * 1024;

/**
 * AC-44 — one Refresh processes at most this many workflow runs per
 * installation, newest first. The remainder ingest on subsequent refreshes.
 */
export const REFRESH_MAX_RUNS = 30;

/** The only provider the vendored runner can construct (AC-67). */
export const RUNNER_PROVIDER = 'openrouter';

/** Fallback slug when a name yields no ASCII characters at all (AC-11). */
export const SLUG_FALLBACK = 'agent';

/** Commit message for the single atomic export commit (AC-27). */
export const COMMIT_MESSAGE = 'chore(devdigest): export agent review to CI';

export const PR_TITLE = 'Add DevDigest agent review to CI';
