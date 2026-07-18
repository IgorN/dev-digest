import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast radius module — "what could these changes break?", read from the
 * already-built repo-intel index (no parsing during review).
 *   POST /pulls/:id/blast/recompute -> synchronous, at most one cheap LLM
 *                                       call (the summary paragraph), persists
 *                                       and returns the fresh BlastRadius
 *   GET  /pulls/:id/blast           -> the persisted BlastRadius, or null
 *                                       when never computed for this PR (200,
 *                                       not 404 — same falsy-check contract
 *                                       as GET /pulls/:id/intent)
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.post(
    '/pulls/:id/blast/recompute',
    { schema: { params: IdParams, body: z.object({}) } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.recompute(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadius | null> => {
      const { workspaceId } = await getContext(app.container, req);
      const blast = await service.get(workspaceId, req.params.id);
      return blast ?? null;
    },
  );
}
