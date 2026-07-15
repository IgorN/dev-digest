# `mcp-server` (`@devdigest/mcp`)

Local-only MCP (Model Context Protocol) server exposing DevDigest's agents,
PR reviews, conventions and (a stub of) blast-radius analysis as 5 MCP tools.

**This package is never started automatically.** It is not part of
`./scripts/dev.sh`, not part of `docker-compose.yml`, and not referenced by
`server/package.json` or `client/package.json`. You start it yourself, only
when you want to use it from an MCP client (Claude Code, Claude Desktop, MCP
Inspector, …).

## What it does

| Tool | Maps to | Notes |
|---|---|---|
| `list_agents` | `GET /agents` | real, already-selectable entity |
| `run_agent_on_pull_request` | `POST /pulls/:id/review` | async; bounded wait, then `run_id` + poll |
| `get_findings` | `GET /pulls/:id/reviews` | poll a run started above, by `run_id` |
| `get_conventions` | `GET /repos/:id/conventions` | accepted conventions only by default |
| `get_blast_radius` | — | **safe stub** — `implemented: false`, no real analysis exists yet |

It talks to the DevDigest HTTP API (`server/`) over `http://localhost:3001`
by default — it does **not** touch Postgres directly.

## 1. Prerequisites

The DevDigest app stack must be running separately (this package does not
start it):

```sh
# from the repo root
./scripts/dev.sh
curl -s http://localhost:3001/agents   # sanity check — should return a JSON array
```

Install this package's own dependencies (separate lockfile from `server/`):

```sh
cd mcp-server
pnpm install
```

## 2. Configuration

Environment variables (all scoped to this package only — never read from or
written to `server/.env`):

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the running DevDigest API |
| `MCP_RUN_WAIT_SECONDS_DEFAULT` | `6` | Default bounded-wait window for `run_agent_on_pull_request` (hard-capped at 20s regardless of this value or the tool's own `wait_seconds` input) |
| `MCP_LOG_LEVEL` | `info` | Reserved; current logging is a handful of `console.error` lines to stderr |

Export them in your shell, or prefix the start command, e.g.:

```sh
DEVDIGEST_API_URL=http://localhost:3001 pnpm start
```

## 3. Run it standalone

```sh
cd mcp-server
pnpm start          # tsx src/main.ts — stdio MCP server; logs go to stderr only
```

The process talks JSON-RPC over stdin/stdout. It does nothing visible until an
MCP client connects and sends `initialize` — that's expected.

Build/typecheck (not required for `pnpm start`, which runs via `tsx`):

```sh
pnpm typecheck
pnpm build           # emits dist/ via tsc
```

## 4. Connect an MCP client

**MCP Inspector (recommended for manual verification):**

```sh
npx @modelcontextprotocol/inspector pnpm --dir /absolute/path/to/mcp-server start
```

Inspector spawns the server itself (stdio), and gives you a `tools/list` view
plus a form to call each tool.

**Claude Code / any stdio MCP client**, via a project-scoped `.mcp.json` at
the repo root (see the file already checked in there):

```json
{
  "mcpServers": {
    "devdigest-local": {
      "command": "pnpm",
      "args": ["--dir", "mcp-server", "start"]
    }
  }
}
```

Inside an interactive Claude Code session: `/mcp` shows connection status and
the 5 registered tools. From a terminal: `claude mcp list`.

## 5. Verify the main app stack does NOT start this

```sh
# Start only the app, not this package:
./scripts/dev.sh          # or: cd server && pnpm dev

ps aux | grep -i 'mcp-server' | grep -v grep     # expect: no output
docker compose ps                                # expect: only the postgres service
grep -R "mcp" scripts/dev.sh docker-compose.yml server/package.json  # expect: no matches
```

Structural guarantee: this package lives outside `server/src/modules/`, so
the static module registry in `server/src/modules/index.ts` (see
`server/CLAUDE.md`) cannot pick it up even by accident — there is no
filesystem autoload.

## 6. Manually exercise all 5 tools

Using MCP Inspector's scriptable CLI mode (`--cli`), with the app stack
running and at least one repo/PR/agent seeded:

```sh
BASE="npx @modelcontextprotocol/inspector --cli pnpm --dir /absolute/path/to/mcp-server start"

# 1) list_agents
$BASE --method tools/call --tool-name list_agents --tool-arg enabled_only=true

# 2) run_agent_on_pull_request (flat args; returns findings inline OR run_id+"running")
$BASE --method tools/call --tool-name run_agent_on_pull_request \
      --tool-arg repo=owner/repo --tool-arg pr_number=42 --tool-arg agent="Default Reviewer"

# 3) get_findings (use the run_id from step 2)
$BASE --method tools/call --tool-name get_findings \
      --tool-arg run_id=<RUN_ID> --tool-arg severity=CRITICAL --tool-arg limit=10

# 4) get_conventions
$BASE --method tools/call --tool-name get_conventions --tool-arg repo=owner/repo

# 5) get_blast_radius (must return status="not_implemented", implemented=false)
$BASE --method tools/call --tool-name get_blast_radius \
      --tool-arg repo=owner/repo --tool-arg pr_number=42
```

## 7. Automated tests

```sh
cd mcp-server
pnpm test        # vitest: pure domain shaping + use-cases against a fake DevDigestApi port — no server, no Docker
pnpm test:it     # protocol-level: real McpServer + Client over InMemoryTransport.createLinkedPair() — no subprocess, no network
```

- `test/domain-shape.test.ts` — pure narrowing/filtering/stub-building functions.
- `test/usecases.test.ts` — all 5 use-cases against `test/fakes.ts`'s `FakeDevDigestApi`.
- `test/tools.it.test.ts` — exercises the actual MCP wire path (`tools/list`, `tools/call`, `isError`) end to end, still against the fake port.

None of these require the DevDigest app stack or Postgres to be running.

## 8. Diagnosing common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Client hangs on `initialize` / "invalid JSON" | Something wrote to stdout besides the SDK (e.g. a stray `console.log`) | All logging in this package uses `console.error` (stderr) — check for new code that logs to stdout |
| `Could not reach the DevDigest API` / `ECONNREFUSED` | App stack isn't running | `./scripts/dev.sh`, then `curl localhost:3001/agents` |
| `run_agent_on_pull_request` always returns `status: "running"` | The review is slower than `wait_seconds` | Expected for slow reviews — call `get_findings` with the returned `run_id`; you can raise `wait_seconds` up to 20 |
| `"agent 'X' not found — call list_agents..."` | Wrong agent name/id | Call `list_agents` first, use the exact `name` or `id` |
| `"PR #N in owner/repo not found..."` | Repo not imported, or PR not synced yet | Import the repo and open its Pull Requests tab in the app once (this syncs PRs from GitHub) before calling the MCP tool |
| `get_findings` says `run_not_found` for a run you just started | The MCP server process restarted between the two calls | Known v1 limitation — the `run_id → pr_id` mapping is in-memory only (see `src/app/run-pr-cache.ts`); re-run `run_agent_on_pull_request` |
| `get_conventions` returns `scanned: false` | Repo has never been scanned for conventions | Run extraction from the DevDigest app itself — this MCP tool deliberately never triggers the expensive extract pass |
| `429` / rate-limited error on `run_agent_on_pull_request` | Upstream rate limit (10 reviews/min per `POST /pulls/:id/review`) | Wait and retry; don't call this tool in a poll loop — use `get_findings` for polling |
