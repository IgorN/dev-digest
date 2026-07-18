/**
 * Domain error — thrown by use-cases (application ring) and infra, always
 * carrying an ALREADY-ACTIONABLE message (image rule #4, "the error leads
 * forward": e.g. "agent 'x' not found — call list_agents", not a bare 404).
 * The transport ring is the only place that turns this into an MCP
 * `isError: true` tool result; nothing in this file touches I/O or the SDK.
 */
export type McpToolErrorCode =
  | 'agent_not_found'
  | 'repo_not_found'
  | 'pull_request_not_found'
  | 'run_not_found'
  | 'invalid_run_request'
  | 'rate_limited'
  | 'upstream_unavailable';

export class McpToolError extends Error {
  constructor(
    public readonly code: McpToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export function isMcpToolError(err: unknown): err is McpToolError {
  return err instanceof McpToolError;
}
