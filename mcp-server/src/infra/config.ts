import { z } from 'zod';

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

/**
 * A var that's SET but not parseable must fail startup loudly, not fall back
 * to a default that silently hides the typo — `.optional()` on each field is
 * what lets an UNSET var still take its default below (Zod skips validation
 * entirely for `undefined`).
 */
const EnvSchema = z.object({
  DEVDIGEST_API_URL: z
    .string()
    .url('must be a valid URL, e.g. http://localhost:3001')
    .optional(),
  MCP_RUN_WAIT_SECONDS_DEFAULT: z.coerce
    .number({ invalid_type_error: 'must be a number' })
    .positive('must be a positive number of seconds')
    .optional(),
  MCP_LOG_LEVEL: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = EnvSchema.safeParse({
    DEVDIGEST_API_URL: env.DEVDIGEST_API_URL,
    MCP_RUN_WAIT_SECONDS_DEFAULT: env.MCP_RUN_WAIT_SECONDS_DEFAULT,
    MCP_LOG_LEVEL: env.MCP_LOG_LEVEL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(env)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid mcp-server environment configuration — ${issues}`);
  }

  return {
    apiBaseUrl: parsed.data.DEVDIGEST_API_URL ?? 'http://localhost:3001',
    defaultWaitSeconds: Math.min(parsed.data.MCP_RUN_WAIT_SECONDS_DEFAULT ?? 6, HARD_MAX_WAIT_SECONDS),
    maxWaitSeconds: HARD_MAX_WAIT_SECONDS,
    logLevel: parsed.data.MCP_LOG_LEVEL ?? 'info',
  };
}
