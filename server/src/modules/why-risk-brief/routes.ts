import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WhyRiskBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { WhyRiskBriefService } from './service.js';

/**
 * Why + Risk Brief module — synthesises the 5 already-computed PR signals
 * (intent, blast radius, smart-diff group counts, live linked issue, bounded
 * Context-Folder docs) into one structured brief via exactly one new
 * `completeStructured` call.
 *   POST /pulls/:id/why-risk-brief/recompute -> synchronous, the one
 *                                                synthesis call (or a
 *                                                degraded skeleton on
 *                                                failure), persists and
 *                                                returns the fresh brief
 *   GET  /pulls/:id/why-risk-brief           -> the persisted brief, or null
 *                                                when never computed for this
 *                                                PR (200, not 404 — same
 *                                                falsy-check contract as
 *                                                GET /pulls/:id/blast)
 */
export default async function whyRiskBriefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WhyRiskBriefService(app.container);

  app.post(
    '/pulls/:id/why-risk-brief/recompute',
    { schema: { params: IdParams, body: z.object({}) } },
    async (req): Promise<WhyRiskBrief> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.recompute(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id/why-risk-brief',
    { schema: { params: IdParams } },
    async (req): Promise<WhyRiskBrief | null> => {
      const { workspaceId } = await getContext(app.container, req);
      const brief = await service.get(workspaceId, req.params.id);
      return brief ?? null;
    },
  );
}
