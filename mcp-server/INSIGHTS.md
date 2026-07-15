# Insights — mcp-server (`@devdigest/mcp`)

Non-obvious findings and gotchas for the local MCP server. Add an entry
whenever something surprised you, so the next agent/session doesn't relearn
it. Append-only — see the `engineering-insights` skill for how entries are
captured.

## What Works

## What Doesn't Work

- **2026-07-15** — Writing a `.env.example` file (even a template with placeholder values, no real secrets) is blocked by the harness's permission settings for any `.env*` path — don't fight it; document env vars directly in `README.md` instead. Evidence: attempted `mcp-server/.env.example`, denied.
- **2026-07-15** — `"test:it": "vitest run test/**/*.it.test.ts"` in `package.json` fails with "No test files found" — plain `sh` doesn't expand `**` (no globstar), so the literal string reaches vitest's CLI filter unglobbed. For a flat `test/` dir, `test/*.it.test.ts` works. Evidence: `mcp-server/package.json`.

## Codebase Patterns

- **2026-07-15** — `run_agent_on_pull_request` → `get_findings` (the async run/poll split) needs a `run_id → pr_id` mapping because the DevDigest API has no `GET /runs/:id` (see `server/INSIGHTS.md`'s 2026-07-15 entry). Implemented as an in-memory `Map` (`src/app/run-pr-cache.ts`) — deliberately NOT durable: it does not survive an MCP server restart between the two calls. A real fix needs a new server-side endpoint (not built in this v1). Evidence: `src/app/run-pr-cache.ts`, `src/app/get-findings.usecase.ts`.

## Tool & Library Notes

- **2026-07-15** — `@modelcontextprotocol/sdk` v1.29.0's `package.json` `exports` map doesn't individually list subpaths like `/server/mcp.js`, `/server/stdio.js`, `/client/index.js`, or `/inMemory.js` — they resolve via a catch-all `"./*"` entry pointing at `dist/esm/*`. `InMemoryTransport` in particular lives at the PACKAGE ROOT (`@modelcontextprotocol/sdk/inMemory.js`), not under `/server/` or `/shared/` — easy to guess wrong. Verified by reading `node_modules/@modelcontextprotocol/sdk/package.json`'s `exports` field and `dist/esm/inMemory.d.ts` directly rather than trusting an import guess.
- **2026-07-15** — `McpServer.registerTool(name, config, cb)`'s `config.inputSchema`/`config.outputSchema` take a raw Zod-shape OBJECT (e.g. `{ repo: z.string() }`), NOT a `z.object({...})` wrapper — passing `z.object()` there is a type error. `config.annotations` is `ToolAnnotations = {readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint?}`, all optional hints per the MCP spec (clients must not treat them as guarantees). Evidence: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`.
- **2026-07-15** — SDK 1.29.0 depends on `"zod": "^3.25 || ^4.0"`. Pinning this package's own `zod` to `^3.24.1` (matching `server/`'s pin, for consistency) still resolves fine via pnpm hoisting to a 3.25.x patch — no version conflict — but it is NOT the identical patch version `server/` uses; don't assume byte-identical zod behavior across the two packages.

## Recurring Errors & Fixes

- **2026-07-15** — A correct project-scoped `.mcp.json` doesn't mean the server is connected: `claude mcp list` can show `devdigest-local` stuck at `⏸ Pending approval (run \`claude\` to approve)` even though the config exactly matches `README.md`'s documented example. Fix: run an interactive `claude` session (or `/mcp` inside one) and approve the server — this is a one-time per-project trust gate, not a config bug. Evidence: `claude mcp list` output, `.mcp.json`.
