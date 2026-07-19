/**
 * Onboarding facts — deterministic literals for the zero-LLM analyzer.
 *
 * These drive the fact-gathering caps and the deterministic stack/run-locally
 * detectors. All bounded and order-independent so fact gathering stays cheap
 * and repeatable (AC-5).
 */

/** How many top-ranked files seed the reading-path section (AC-6). */
export const READING_PATH_LIMIT = 12;

/**
 * How many of the top-ranked reading-path files we pull symbols from to seed
 * the first-tasks section (AC-10). Kept small — a handful of grounded files,
 * not a repo-wide symbol dump.
 */
export const FIRST_TASK_FILE_LIMIT = 5;

/**
 * Substrings excluded from the reading-path. `getTopFilesByRank` already strips
 * build/test junk via its own `isJunkPath`; these narrow it further to keep the
 * guided reading order focused on source, not test scaffolding.
 */
export const READING_PATH_EXCLUDE: string[] = ['.test.', '.spec.', '__tests__'];

/** Root `package.json` — the deterministic stack + scripts source (D1). */
export const PACKAGE_JSON_PATH = 'package.json';

/**
 * Hard cap on `OnboardingSection.commands` for the `run-locally` section —
 * applied BOTH to the deterministic skeleton list and to whatever the model
 * returns (post-validated in `generate.ts`). A first-day tour shows a short,
 * runnable sequence, not every script in the manifest.
 */
export const RUN_LOCALLY_COMMAND_CAP = 12;

/**
 * Environment-template file base names that signal a documented local-run
 * path (D1). Matched on the file's base name, anywhere in the tree.
 */
export const ENV_EXAMPLE_NAMES: string[] = ['.env.example', '.env.sample', '.env.template'];

/**
 * `package.json` dependency name → friendly framework/library label. A bounded,
 * order-independent lookup for the deterministic stack detector — a hit means
 * "this dependency is present", never fabricated. Non-JS/TS stacks (no
 * `package.json`, or deps we don't recognise) simply yield fewer labels; we
 * never invent a framework the manifest doesn't list (AC-13).
 */
export const FRAMEWORK_MARKERS: Record<string, string> = {
  next: 'Next.js',
  react: 'React',
  'react-dom': 'React',
  vue: 'Vue',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  fastify: 'Fastify',
  express: 'Express',
  '@nestjs/core': 'NestJS',
  koa: 'Koa',
  hono: 'Hono',
  'drizzle-orm': 'Drizzle ORM',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  typeorm: 'TypeORM',
  mongoose: 'Mongoose',
  vitest: 'Vitest',
  jest: 'Jest',
  typescript: 'TypeScript',
  tailwindcss: 'Tailwind CSS',
  '@tanstack/react-query': 'TanStack Query',
  zod: 'Zod',
  vite: 'Vite',
  webpack: 'webpack',
};
