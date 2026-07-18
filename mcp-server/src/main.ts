#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './infra/config.js';
import { HttpDevDigestApi } from './infra/http-client.js';
import { RunPrCache } from './app/run-pr-cache.js';
import { makeListAgentsUseCase } from './app/list-agents.usecase.js';
import { makeRunAgentOnPrUseCase } from './app/run-agent-on-pr.usecase.js';
import { makeGetFindingsUseCase } from './app/get-findings.usecase.js';
import { makeGetConventionsUseCase } from './app/get-conventions.usecase.js';
import { makeGetBlastRadiusUseCase } from './app/get-blast-radius.usecase.js';
import { registerTools } from './transport/tools.js';

/**
 * Composition root. Wires infra (HTTP client, env config) -> ports ->
 * application use-cases -> transport (MCP tool registration), then connects
 * over stdio. This file is the ONLY place that constructs concrete adapters —
 * everything downstream depends on the `DevDigestApi` port, not on
 * `HttpDevDigestApi` directly (DIP, mirrors server/src/platform/container.ts).
 *
 * Standalone by design: nothing here is invoked by `server/`, `client/`,
 * `scripts/dev.sh`, or `docker-compose.yml`. This process starts only when a
 * user or MCP client (Claude Code, MCP Inspector, …) explicitly runs
 * `pnpm start` in this package, or spawns it per `.mcp.json`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const api = new HttpDevDigestApi(config.apiBaseUrl);
  const cache = new RunPrCache();

  const server = new McpServer({ name: 'devdigest-mcp', version: '0.1.0' });

  registerTools(server, {
    listAgents: makeListAgentsUseCase({ api }),
    runAgentOnPr: makeRunAgentOnPrUseCase({
      api,
      cache,
      defaultWaitSeconds: config.defaultWaitSeconds,
      maxWaitSeconds: config.maxWaitSeconds,
    }),
    getFindings: makeGetFindingsUseCase({ api, cache }),
    getConventions: makeGetConventionsUseCase({ api }),
    getBlastRadius: makeGetBlastRadiusUseCase(),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for JSON-RPC frames (stdio transport rule) — every log
  // line goes to stderr instead, or a stray console.log would break the
  // client's connection (best practice #10).
  console.error(`[devdigest-mcp] ready — talking to DevDigest API at ${config.apiBaseUrl}`);
}

main().catch((err) => {
  console.error('[devdigest-mcp] fatal error during startup', err);
  process.exit(1);
});
