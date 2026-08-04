import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiExportInput,
  CiRunStatus,
  type CiExport,
  type CiIngestResult,
  type CiInstallation,
  type CiRunsResponse,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';
import { CiIngestService } from './ingest.js';

/**
 * TRANSPORT — Export to CI.
 *
 *   POST /agents/:id/export-ci       action:'files'   → generate only (no commit)
 *                                    action:'open_pr' → commit + PR + installation
 *   POST /agents/:id/export-ci/zip   the same file set as an archive, zero GitHub calls
 *   GET  /agents/:id/ci-installations the agent CI tab's rows
 *   GET  /ci-runs                     workspace CI runs + the chip row's facets
 *   POST /ci-runs/refresh             pull results from GitHub Actions
 *
 * There is deliberately NO webhook route and NO upload route (AC-35): a webhook
 * cannot be verified from a local machine, so Refresh is the only ingest path.
 *
 * Routes validate, resolve tenancy via `getContext` and delegate to
 * `service`/`ingest` — never to the repository, and never hand-building an
 * error response (the central handler serializes the typed errors).
 */

/** Rate cap for every route that makes outbound authenticated GitHub calls (R11). */
const GITHUB_RATE_LIMIT = { rateLimit: { max: 6, timeWindow: '1 minute' } } as const;

const CiRunsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  status: CiRunStatus.optional(),
  /** ISO timestamp — the date-range chip's lower bound. */
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);
  const ingest = new CiIngestService(app.container);

  // ---- generate / install --------------------------------------------------
  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput }, config: GITHUB_RATE_LIMIT },
    async (req): Promise<CiExport> => {
      const { workspaceId } = await getContext(app.container, req);
      return req.body.action === 'open_pr'
        ? service.install(workspaceId, req.params.id, req.body)
        : service.generate(workspaceId, req.params.id, req.body);
    },
  );

  // ---- zip fallback (AC-78) — same generation, ZERO GitHub calls ------------
  app.post(
    '/agents/:id/export-ci/zip',
    { schema: { params: IdParams, body: CiExportInput }, config: GITHUB_RATE_LIMIT },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { bytes, filename } = await service.zip(workspaceId, req.params.id, req.body);
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(Buffer.from(bytes));
    },
  );

  // ---- agent CI tab --------------------------------------------------------
  app.get(
    '/agents/:id/ci-installations',
    { schema: { params: IdParams } },
    async (req): Promise<CiInstallation[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.installations(workspaceId, req.params.id);
    },
  );

  // ---- CI Runs page --------------------------------------------------------
  app.get(
    '/ci-runs',
    { schema: { querystring: CiRunsQuery } },
    async (req): Promise<CiRunsResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, {
        agentId: req.query.agent_id,
        repo: req.query.repo,
        status: req.query.status,
        since: req.query.since ? new Date(req.query.since) : undefined,
        limit: req.query.limit,
      });
    },
  );

  app.post(
    '/ci-runs/refresh',
    { config: GITHUB_RATE_LIMIT },
    async (req): Promise<CiIngestResult> => {
      const { workspaceId } = await getContext(app.container, req);
      return ingest.refresh(workspaceId);
    },
  );
}
