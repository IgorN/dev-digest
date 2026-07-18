# Insights — mcp-server (`@devdigest/mcp`)

Non-obvious findings and gotchas for the local MCP server. Add an entry
whenever something surprised you, so the next agent/session doesn't relearn
it. Append-only — see the `engineering-insights` skill for how entries are
captured.

## What Works

## What Doesn't Work

- **2026-07-15** — Writing a `.env.example` file (even a template with placeholder values, no real secrets) is blocked by the harness's permission settings for any `.env*` path — don't fight it; document env vars directly in `README.md` instead. Evidence: attempted `mcp-server/.env.example`, denied.
- **2026-07-15** — `"test:it": "vitest run test/**/*.it.test.ts"` in `package.json` fails with "No test files found" — plain `sh` doesn't expand `**` (no globstar), so the literal string reaches vitest's CLI filter unglobbed. For a flat `test/` dir, `test/*.it.test.ts` works. Evidence: `mcp-server/package.json`.

- **2026-07-15** — `tsx` resolves `tsconfig.json` path aliases (`@devdigest/*`) relative to `process.cwd()` at invocation time, NOT relative to the entry script's own file location. A `bin` shim meant to be run from an arbitrary directory (e.g. `devdigest review --mode working` invoked from some OTHER repo the user is actually working in) silently fails to resolve `@devdigest/reviewer-core`/`@devdigest/shared` unless you pass `tsx --tsconfig <absolute path to this package's tsconfig.json>` explicitly — confirmed by reproducing the failure running from `/tmp` vs. from `mcp-server/` itself. Fix: `bin/devdigest.js` hardcodes the absolute tsconfig path via `import.meta.url`, not a relative one. Evidence: `mcp-server/bin/devdigest.js`.
- **2026-07-15** — vitest/vite does NOT read `tsconfig.json`'s `paths` automatically — a file that typechecks fine (`tsc --noEmit` succeeds) can still fail at test time with `Failed to load url @devdigest/reviewer-core... Does the file exist?`. Needs an explicit `resolve.alias` in `vitest.config.ts` mirroring the tsconfig paths (same fix `server/vitest.config.ts` already applies for the same two packages). Evidence: `mcp-server/vitest.config.ts`.

## Codebase Patterns

- **2026-07-15** — Reusing `reviewer-core`'s `reviewPullRequest` from a THIRD package (not just `server/`) needs BOTH `@devdigest/reviewer-core` (→ `../reviewer-core/src/index.ts`) AND `@devdigest/shared` (→ `../server/src/vendor/shared/index.ts`) path aliases in the consumer's own tsconfig — TypeScript treats path-aliased files as part of the SAME program using the CONSUMER's `paths`, so when reviewer-core's own internal `import ... from '@devdigest/shared'` lines get processed, they resolve through whoever pulled reviewer-core in, not through reviewer-core's own tsconfig. `server/tsconfig.json` "gets away with" only listing `@devdigest/reviewer-core` because it separately already has `@devdigest/shared` defined for its own use, pointing at the exact same physical folder reviewer-core's own tsconfig also targets — that's not automatic, it's two independent configs happening to agree. A NEW consumer must define both aliases itself. Runtime confirms this is a REAL (not just type-level) dependency: `reviewer-core/src/review/run.ts` does `import { Review as ReviewSchema } from '@devdigest/shared'` as a VALUE (zod schema, used for real validation), not `import type`. Evidence: `mcp-server/tsconfig.json`, `reviewer-core/tsconfig.json`, `server/tsconfig.json`, `reviewer-core/src/review/run.ts:10`.

- **2026-07-15** — `run_agent_on_pull_request` → `get_findings` (the async run/poll split) needs a `run_id → pr_id` mapping because the DevDigest API has no `GET /runs/:id` (see `server/INSIGHTS.md`'s 2026-07-15 entry). Implemented as an in-memory `Map` (`src/app/run-pr-cache.ts`) — deliberately NOT durable: it does not survive an MCP server restart between the two calls. A real fix needs a new server-side endpoint (not built in this v1). Evidence: `src/app/run-pr-cache.ts`, `src/app/get-findings.usecase.ts`.

## Tool & Library Notes

- **2026-07-15** — `@modelcontextprotocol/sdk` v1.29.0's `package.json` `exports` map doesn't individually list subpaths like `/server/mcp.js`, `/server/stdio.js`, `/client/index.js`, or `/inMemory.js` — they resolve via a catch-all `"./*"` entry pointing at `dist/esm/*`. `InMemoryTransport` in particular lives at the PACKAGE ROOT (`@modelcontextprotocol/sdk/inMemory.js`), not under `/server/` or `/shared/` — easy to guess wrong. Verified by reading `node_modules/@modelcontextprotocol/sdk/package.json`'s `exports` field and `dist/esm/inMemory.d.ts` directly rather than trusting an import guess.
- **2026-07-15** — `McpServer.registerTool(name, config, cb)`'s `config.inputSchema`/`config.outputSchema` take a raw Zod-shape OBJECT (e.g. `{ repo: z.string() }`), NOT a `z.object({...})` wrapper — passing `z.object()` there is a type error. `config.annotations` is `ToolAnnotations = {readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint?}`, all optional hints per the MCP spec (clients must not treat them as guarantees). Evidence: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`.
- **2026-07-15** — SDK 1.29.0 depends on `"zod": "^3.25 || ^4.0"`. Pinning this package's own `zod` to `^3.24.1` (matching `server/`'s pin, for consistency) still resolves fine via pnpm hoisting to a 3.25.x patch — no version conflict — but it is NOT the identical patch version `server/` uses; don't assume byte-identical zod behavior across the two packages.

## Recurring Errors & Fixes

- **2026-07-15** — A correct project-scoped `.mcp.json` doesn't mean the server is connected: `claude mcp list` can show `devdigest-local` stuck at `⏸ Pending approval (run \`claude\` to approve)` even though the config exactly matches `README.md`'s documented example. Fix: run an interactive `claude` session (or `/mcp` inside one) and approve the server — this is a one-time per-project trust gate, not a config bug. Evidence: `claude mcp list` output, `.mcp.json`.

## Session Notes

### 2026-07-15
- Added a second entry point to this package: `devdigest review --mode working` (pre-push CLI homework). New `src/domain/{diff,cli-args,format-review}.ts`, `src/ports/git.ts` + `src/infra/git.ts`, `src/infra/llm.ts`, `src/app/review-working-tree.usecase.ts`, `src/cli/main.ts` (a second composition root alongside `main.ts`), `bin/devdigest.js`. Reuses the real `reviewer-core.reviewPullRequest` engine and the real agent config (fetched live via the existing `DevDigestApi` port) — the diff parser is the only vendored/duplicated logic (mcp-server has no path back into `server/`).
- Verified live end-to-end against a real repo's real uncommitted diff: confirmed the full chain (git diff → parse → fetch "General Reviewer" from the running server → construct `OpenRouterProvider` → real HTTPS request to openrouter.ai) by deliberately using an invalid key and observing a genuine `401` from OpenRouter's real API (not a mock) — proves every hop without needing/touching the user's real credential.
- 42 unit tests + 6 protocol tests, all green; `npm run typecheck` clean.

## Open Questions
