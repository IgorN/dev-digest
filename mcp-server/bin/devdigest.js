#!/usr/bin/env node
/**
 * `bin` shim — this package ships TypeScript source only (no build step in
 * dev, same as `main.ts`), so the actual CLI logic runs through `tsx`. This
 * tiny JS file is what `npm link`/`npm install -g` can point `bin` at.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'cli', 'main.ts');
const tsconfig = join(here, '..', 'tsconfig.json');
const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');

// The user runs `devdigest` from THEIR project's directory, not this
// package's — tsx resolves tsconfig.json path aliases (@devdigest/*)
// relative to the CURRENT WORKING DIRECTORY, not the script's location, so
// without `--tsconfig` an invocation from anywhere but mcp-server/ itself
// fails to resolve `@devdigest/reviewer-core` / `@devdigest/shared`.
const result = spawnSync(tsx, ['--tsconfig', tsconfig, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
