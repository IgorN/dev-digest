/**
 * Infrastructure ring — reads env directly (the only ring allowed to). Every
 * env var here is scoped to THIS package; nothing is read from or written to
 * `server/.env` or the main app's config.
 */
export interface McpConfig {
  apiBaseUrl: string;
  defaultWaitSeconds: number;
  maxWaitSeconds: number;
  logLevel: string;
}

const HARD_MAX_WAIT_SECONDS = 20;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const requestedDefault = Number(env.MCP_RUN_WAIT_SECONDS_DEFAULT ?? 6);
  const defaultWaitSeconds =
    Number.isFinite(requestedDefault) && requestedDefault > 0
      ? Math.min(requestedDefault, HARD_MAX_WAIT_SECONDS)
      : 6;
  return {
    apiBaseUrl: env.DEVDIGEST_API_URL ?? 'http://localhost:3001',
    defaultWaitSeconds,
    maxWaitSeconds: HARD_MAX_WAIT_SECONDS,
    logLevel: env.MCP_LOG_LEVEL ?? 'info',
  };
}
