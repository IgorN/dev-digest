import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeDevDigestApi } from './fakes.js';
import { registerTools } from '../src/transport/tools.js';
import { makeListAgentsUseCase } from '../src/app/list-agents.usecase.js';
import { makeRunAgentOnPullRequestUseCase } from '../src/app/run-agent-on-pull-request.usecase.js';
import { makeGetFindingsUseCase } from '../src/app/get-findings.usecase.js';
import { makeGetConventionsUseCase } from '../src/app/get-conventions.usecase.js';
import { makeGetBlastRadiusUseCase } from '../src/app/get-blast-radius.usecase.js';
import { RunPrCache } from '../src/app/run-pr-cache.js';

/**
 * Protocol-level integration test: a real `Client` + `McpServer` talking
 * over `InMemoryTransport.createLinkedPair()` (best practice #11) — no
 * subprocess, no network, no DevDigest server required (the port is a fake).
 * Exercises the actual MCP wire path (`tools/list`, `tools/call`,
 * `isError`), not just the use-case functions directly.
 */
async function setup() {
  const api = new FakeDevDigestApi();
  const cache = new RunPrCache();
  const server = new McpServer({ name: 'devdigest-mcp-test', version: '0.0.0' });
  registerTools(server, {
    listAgents: makeListAgentsUseCase({ api }),
    runAgentOnPullRequest: makeRunAgentOnPullRequestUseCase({
      api,
      cache,
      defaultWaitSeconds: 1,
      maxWaitSeconds: 20,
      sleep: async () => {},
    }),
    getFindings: makeGetFindingsUseCase({ api, cache }),
    getConventions: makeGetConventionsUseCase({ api }),
    getBlastRadius: makeGetBlastRadiusUseCase(),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { api, client, server };
}

describe('MCP protocol surface', () => {
  it('lists exactly the 5 approved tools', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_blast_radius',
      'get_conventions',
      'get_findings',
      'list_agents',
      'run_agent_on_pull_request',
    ]);
  });

  it('list_agents returns structured content with narrowed fields', async () => {
    const { client, api } = await setup();
    api.agents = [
      { id: 'a1', name: 'Strict Reviewer', description: 'd', provider: 'anthropic', model: 'm', enabled: true },
    ];
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      agents: [{ name: 'Strict Reviewer', description: 'd', provider: 'anthropic', model: 'm', enabled: true }],
    });
  });

  it('run_agent_on_pull_request -> get_findings round trip when the run finishes fast', async () => {
    const { client, api } = await setup();
    api.repos = [{ id: 'repo-1', owner: 'o', name: 'r', full_name: 'o/r' }];
    api.agents = [{ id: 'a1', name: 'Reviewer', description: 'd', provider: 'anthropic', model: 'm', enabled: true }];
    api.pulls['repo-1'] = [{ id: 'pr-1', number: 5, title: 'PR' }];
    api.completeOnNextPoll = { status: 'done' };
    api.reviews['pr-1'] = [{ run_id: 'run-1', verdict: 'approve', findings: [] }];

    const runResult = await client.callTool({
      name: 'run_agent_on_pull_request',
      arguments: { repo: 'o/r', pr_number: 5, agent: 'Reviewer', wait_seconds: 1 },
    });
    expect(runResult.isError).toBeFalsy();
    expect(runResult.structuredContent).toMatchObject({ status: 'done', verdict: 'approve', run_id: 'run-1' });

    const findingsResult = await client.callTool({ name: 'get_findings', arguments: { run_id: 'run-1' } });
    expect(findingsResult.isError).toBeFalsy();
    expect(findingsResult.structuredContent).toMatchObject({ status: 'done', total_findings: 0 });
  });

  it('returns isError:true with an actionable message for an unknown agent (image rule #4)', async () => {
    const { client, api } = await setup();
    api.repos = [{ id: 'repo-1', owner: 'o', name: 'r', full_name: 'o/r' }];
    api.pulls['repo-1'] = [{ id: 'pr-1', number: 5, title: 'PR' }];

    const result = await client.callTool({
      name: 'run_agent_on_pull_request',
      arguments: { repo: 'o/r', pr_number: 5, agent: 'ghost', wait_seconds: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('list_agents');
  });

  it('get_conventions returns scanned:false for an unscanned repo', async () => {
    const { client, api } = await setup();
    api.repos = [{ id: 'repo-1', owner: 'o', name: 'r', full_name: 'o/r' }];
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'o/r' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ repo: 'o/r', conventions: [], scanned: false });
  });

  it('get_blast_radius always reports implemented:false, never fabricated data', async () => {
    const { client } = await setup();
    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'o/r', pr_number: 5 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: 'not_implemented', implemented: false, affected: [] });
  });
});
