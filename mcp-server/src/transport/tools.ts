import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isMcpToolError } from '../domain/errors.js';
import { Severity, FindingCategory } from '../vendor/shared/findings.js';
import {
  LIST_AGENTS_DESCRIPTION,
  RUN_AGENT_ON_PULL_REQUEST_DESCRIPTION,
  GET_FINDINGS_DESCRIPTION,
  GET_CONVENTIONS_DESCRIPTION,
  GET_BLAST_RADIUS_DESCRIPTION,
} from './descriptions.js';
import type { ListAgentsInput } from '../app/list-agents.usecase.js';
import type { RunAgentOnPullRequestInput } from '../app/run-agent-on-pull-request.usecase.js';
import type { GetFindingsInput } from '../app/get-findings.usecase.js';
import type { GetConventionsInput } from '../app/get-conventions.usecase.js';
import type { GetBlastRadiusInput } from '../app/get-blast-radius.usecase.js';

/**
 * Transport ring — the outer edge. Registers the 5 MCP tools: Zod
 * `inputSchema`s (flat primitives only, image rule #2), the English
 * descriptions above, `ToolAnnotations`, and the isError mapping
 * (image rule #4: `McpToolError.message` is already actionable text, built
 * by the use-case that threw it — this layer only serializes it).
 */
export interface ToolUseCases {
  listAgents: (input: ListAgentsInput) => Promise<unknown>;
  runAgentOnPullRequest: (input: RunAgentOnPullRequestInput) => Promise<unknown>;
  getFindings: (input: GetFindingsInput) => Promise<unknown>;
  getConventions: (input: GetConventionsInput) => Promise<unknown>;
  getBlastRadius: (input: GetBlastRadiusInput) => unknown;
}

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function run(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    if (isMcpToolError(err)) return errorResult(err.message);
    return errorResult(`Unexpected error: ${(err as Error).message}`);
  }
}

export function registerTools(server: McpServer, useCases: ToolUseCases): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: {
        enabled_only: z.boolean().optional().describe('Only return enabled agents (default true).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ enabled_only }) => run(() => useCases.listAgents({ enabled_only })),
  );

  server.registerTool(
    'run_agent_on_pull_request',
    {
      title: 'Run agent on pull request',
      description: RUN_AGENT_ON_PULL_REQUEST_DESCRIPTION,
      inputSchema: {
        repo: z.string().min(1).describe('Repository full name, e.g. "owner/repo".'),
        pr_number: z.number().int().positive().describe('The pull request number (not its internal id).'),
        agent: z.string().min(1).describe('Agent name or id, from list_agents.'),
        wait_seconds: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe('How long to wait inline for the review to finish before returning a run_id (default 6, max 20).'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Optional client-supplied key (not yet deduplicated upstream — reserved for a future API change).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ repo, pr_number, agent, wait_seconds, idempotency_key }) =>
      run(() =>
        useCases.runAgentOnPullRequest({
          repo,
          pr_number,
          agent,
          wait_seconds,
          idempotency_key,
        }),
      ),
  );

  server.registerTool(
    'get_findings',
    {
      title: 'Get findings',
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: {
        run_id: z.string().min(1).describe('The run_id returned by run_agent_on_pull_request.'),
        severity: Severity.optional().describe('Filter to one severity.'),
        category: FindingCategory.optional().describe('Filter to one category.'),
        limit: z.number().int().positive().optional().describe('Max findings to return (default 20).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ run_id, severity, category, limit }) =>
      run(() => useCases.getFindings({ run_id, severity, category, limit })),
  );

  server.registerTool(
    'get_conventions',
    {
      title: 'Get conventions',
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: {
        repo: z.string().min(1).describe('Repository full name, e.g. "owner/repo".'),
        include_candidates: z
          .boolean()
          .optional()
          .describe('Also include unreviewed/rejected candidates (default false: accepted only).'),
        category: z.string().optional().describe('Filter to one convention category.'),
        limit: z.number().int().positive().optional().describe('Max conventions to return (default 50).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ repo, include_candidates, category, limit }) =>
      run(() => useCases.getConventions({ repo, include_candidates, category, limit })),
  );

  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius (stub)',
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: {
        repo: z.string().min(1).describe('Repository full name, e.g. "owner/repo".'),
        pr_number: z.number().int().positive().describe('The pull request number.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ repo, pr_number }) => run(() => useCases.getBlastRadius({ repo, pr_number })),
  );
}
