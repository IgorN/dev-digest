/**
 * Smart Diff classification constants — the ONLY place classification
 * patterns and thresholds live. `classify.ts` and `service.ts` import from
 * here rather than embedding regex/magic numbers inline, so the rules stay
 * auditable and tunable in one spot.
 *
 * Paths are GitHub-style, always `/`-separated regardless of server OS (see
 * `PrFile.path`, sourced from the `pr_files` table which mirrors the GitHub
 * API response), so every pattern below matches on a literal `/`.
 */

/**
 * Boilerplate: files whose diff carries near-zero reviewer signal — lock
 * files (at ANY path depth: repo root or a nested workspace package),
 * snapshot-test output, and generated build directories.
 *
 * The lock-file match is a HARD, graded requirement: `pnpm-lock.yaml` /
 * `package-lock.json` / `yarn.lock` must classify as boilerplate regardless
 * of how deep the file lives in the tree.
 */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // Package-manager lock files, at any nesting depth.
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  // Snapshot test output, anywhere in the tree.
  /\.snap$/,
  // Generated build/output directories — everything under them is
  // boilerplate ("`.next/`-style generated output").
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)out\//,
  /(^|\/)coverage\//,
  // Generically-named generated-output directories (framework-agnostic,
  // alongside the framework-specific ones above).
  /(^|\/)generated\//,
  // TypeScript declaration files — machine-emitted from source, not
  // hand-written, so they carry no independent reviewer signal.
  /\.d\.ts$/,
  // SVG assets — visual/markup, not reviewable as code.
  /\.svg$/,
];

/**
 * Wiring: config/metadata/plumbing files. Not business logic, but not inert
 * either — they get their own (non-collapsed) review section between `core`
 * and `boilerplate` rather than being lumped into either.
 */
export const WIRING_PATTERNS: RegExp[] = [
  // Barrel/index files.
  /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/,
  // TypeScript project config (tsconfig.json, tsconfig.build.json, ...).
  /(^|\/)tsconfig(\..+)?\.json$/,
  // Node package manifest.
  /(^|\/)package\.json$/,
  // Tool config files (eslint/prettier/vite/next/tailwind/vitest/jest/...).
  /(^|\/)\.?[\w.-]+\.config\.(ts|js|mjs|cjs|json)$/,
  /(^|\/)\.eslintrc(\..+)?$/,
  /(^|\/)\.prettierrc(\..+)?$/,
  // CI configuration.
  /(^|\/)\.github\/workflows\/.+\.ya?ml$/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  // Container/orchestration wiring.
  /(^|\/)Dockerfile(\..+)?$/,
  /(^|\/)docker-compose(\..+)?\.ya?ml$/,
];

/**
 * PR-size threshold (Design decision G): total (additions + deletions),
 * summed over `core` + `wiring` files ONLY — boilerplate is excluded so a
 * huge lockfile diff can never trip "this PR is too big". Starting value
 * chosen to align with the client's existing "Large" PR-size bucket
 * (`SIZE_MEDIUM_MAX`), re-declared here deliberately (server-side constant,
 * not shared/imported — this feature needs zero contract changes).
 */
export const SMART_DIFF_TOO_BIG_LINES = 400;
