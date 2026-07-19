import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ContextService } from './service.js';
import { MAX_DOCUMENT_PATH_LENGTH } from './constants.js';

/**
 * Project Context reader (L06).
 *   GET /repos/:id/context          → markdown inventory under configured roots
 *   GET /repos/:id/context/document → one document's content (?path=…)
 *
 * Read-only and deterministic (zero LLM calls). Attach/reorder persistence
 * lives on the agents/skills modules; run-time injection on reviews.
 */

const PreviewQuery = z.object({
  path: z.string().min(1).max(MAX_DOCUMENT_PATH_LENGTH),
});

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService(app.container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const inventory = await service.inventory(workspaceId, req.params.id);
    if (!inventory) throw new NotFoundError('Repo not found');
    return inventory;
  });

  app.get(
    '/repos/:id/context/document',
    { schema: { params: IdParams, querystring: PreviewQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.preview(workspaceId, req.params.id, req.query.path);
      if (!doc) throw new NotFoundError('Repo not found');
      return doc;
    },
  );
}
