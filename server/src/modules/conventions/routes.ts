import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions extractor (L03).
 *   POST /repos/:id/conventions/extract     → scan repo → verified candidates
 *   GET  /repos/:id/conventions             → list candidates (+ scan meta)
 *   POST /repos/:id/conventions/bulk        → accept/reject all
 *   GET  /repos/:id/conventions/skill-draft → merged `repo-conventions` draft
 *   PATCH /conventions/:id                  → accept/reject/edit one candidate
 *
 * Skills are created from accepted candidates via the existing POST /skills.
 */

const BulkBody = z.object({ accepted: z.boolean() });

const PatchBody = z.object({
  accepted: z.boolean().nullish(),
  rule: z.string().min(1).optional(),
  category: z.string().nullish(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams, body: z.object({}) } },
    async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.extract(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Repo not found');
    return result;
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.list(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Repo not found');
    return result;
  });

  app.post(
    '/repos/:id/conventions/bulk',
    { schema: { params: IdParams, body: BulkBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.setAll(workspaceId, req.params.id, req.body.accepted);
      if (!ok) throw new NotFoundError('Repo not found');
      return service.list(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const draft = await service.skillDraft(workspaceId, req.params.id);
      if (!draft) throw new NotFoundError('Repo not found');
      return draft;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );
}
