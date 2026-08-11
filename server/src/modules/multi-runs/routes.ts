import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type {
  AgentRunEstimate,
  LatestMultiRunResponse,
  MultiRunDocument,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError } from '../../platform/errors.js';
import { MultiRunService } from './service.js';

/**
 * multi-runs module — Multi-Agent Review reads.
 *
 *   GET /multi-runs/:id       → the whole multi-run as one document (404 on an
 *                               unresolvable / cross-workspace id)
 *   GET /multi-runs/latest    → the newest multi-run for ONE scope
 *                               (`?repoId=` or `?prId=`), always 2xx, with
 *                               `{ multi_run: null }` when the scope has none
 *   GET /agent-estimates      → per-agent pre-run duration/cost estimates
 *
 * All three are DB-only reads that make ZERO model calls, so none of them
 * overrides the global rate-limit bucket — unlike the launch route, which fans
 * out to expensive LLM runs and keeps its own tighter per-route limit.
 *
 * Routes call `service.*` only, never the repository directly.
 */

/**
 * Scope for the latest-multi-run resolver. Both fields are optional HERE so the
 * "exactly one" rule can be reported as a typed 400 by the handler rather than
 * as a generic schema 422 — supplying both or neither is a caller mistake worth
 * naming.
 */
const LatestQuery = z.object({
  repoId: z.string().uuid().optional(),
  prId: z.string().uuid().optional(),
});

export default async function multiRunsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MultiRunService(app.container);

  // ---- Newest multi-run for a scope --------------------------------------
  // Registered before the parametric sibling for readability only: Fastify's
  // router resolves the STATIC `/multi-runs/latest` ahead of `/multi-runs/:id`
  // regardless of registration order, and every multi-run id is a uuid, so the
  // two can never collide.
  app.get(
    '/multi-runs/latest',
    { schema: { querystring: LatestQuery } },
    async (req): Promise<LatestMultiRunResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const { repoId, prId } = req.query;
      if ((repoId === undefined) === (prId === undefined)) {
        throw new AppError(
          'invalid_scope',
          'Provide exactly one of repoId or prId',
          400,
        );
      }
      // Workspace-scoped inside the service/repository: a repoId from another
      // workspace resolves to the empty result, never to a foreign multi-run.
      return service.latestMultiRun(
        workspaceId,
        repoId !== undefined ? { repoId } : { prId: prId! },
      );
    },
  );

  // ---- One multi-run's result document ------------------------------------
  app.get(
    '/multi-runs/:id',
    { schema: { params: IdParams } },
    async (req): Promise<MultiRunDocument> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDocument(workspaceId, req.params.id);
    },
  );

  // ---- Per-agent pre-run estimates ----------------------------------------
  app.get('/agent-estimates', async (req): Promise<AgentRunEstimate[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.estimates(workspaceId);
  });
}
