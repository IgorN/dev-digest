# mcp-server (`@devdigest/mcp`)

Local-only MCP server exposing DevDigest as 5 MCP tools. Stdio transport,
pnpm. **Never started by the main app** — no entry in `scripts/dev.sh`,
`docker-compose.yml`, or `server|client/package.json`.

## Before answering
Read `mcp-server/README.md` (run/test/diagnose) and `mcp-server/INSIGHTS.md`
before reading code.

## Architecture (Onion, own small instance — see `onion-architecture` skill
for the vocabulary this mirrors)
- `src/domain/` — pure, zero I/O: response narrowing (`shape.ts`) and the
  domain error type (`errors.ts`).
- `src/ports/devdigest-api.ts` — the `DevDigestApi` interface use-cases
  depend on (DIP), plus `UpstreamHttpError`.
- `src/infra/` — the ONLY I/O layer: `http-client.ts` (implements
  `DevDigestApi` over `fetch` against the DevDigest HTTP API) and
  `config.ts` (env reading).
- `src/app/*.usecase.ts` — one use-case per tool; each is a `make*UseCase(deps)`
  factory taking its port dependencies, for easy fake-based testing.
- `src/transport/` — `descriptions.ts` (the 5 English tool descriptions) and
  `tools.ts` (`registerTool` wiring: Zod input schemas, `ToolAnnotations`,
  `isError` mapping).
- `src/main.ts` — composition root; the only file that constructs
  `HttpDevDigestApi` directly.

## Conventions (not obvious from code)
- Connects to `server/`'s existing HTTP API (`DEVDIGEST_API_URL`, default
  `:3001`) — no direct Drizzle/Postgres access, no auth header (the app's
  `LocalNoAuthProvider` needs none today).
- `run_agent_on_pr` does a short **bounded wait** (default 6s, hard
  cap 20s) then falls back to `run_id` + `status:"running"`; `get_findings`
  polls by `run_id`. The `run_id → pr_id` mapping is an **in-memory-only**
  cache (`src/app/run-pr-cache.ts`) — it does not survive a server restart
  (known v1 gap; closing it needs a `GET /runs/:id` endpoint on `server/`,
  not yet built).
- `get_blast_radius` is a **safe stub** — `implemented: false` always, no
  `DevDigestApi` dependency, never fabricates data.
- `src/vendor/shared/` is a **hand-synced, minimal** copy of the fields this
  package needs from `@devdigest/shared` — same vendoring convention as
  `server/src/vendor/shared/` / `client/src/vendor/shared/`, but NOT kept in
  lock-step automatically; extend by copying more fields when a new tool
  needs them.
- Every log line goes to `console.error` (stderr) — stdout is reserved for
  JSON-RPC frames (stdio transport rule); a stray `console.log` breaks the
  client connection.

## Do-not-touch (without coordination)
- `src/vendor/shared/` — hand-synced; check the upstream contract in
  `server/src/vendor/shared/contracts/` before changing a field.
- Do not add this package to `scripts/dev.sh`, `docker-compose.yml`, or any
  `server|client` `package.json` script — that would violate the
  "standalone only" requirement this package exists to satisfy.

## Use when
- Run/test/connect-a-client/diagnose → `mcp-server/README.md`
- Gotchas/findings → `mcp-server/INSIGHTS.md`
- Onion ring vocabulary → `.claude/skills/onion-architecture`
- Tests: `pnpm test` (unit, fake port) / `pnpm test:it` (protocol, `InMemoryTransport`)
