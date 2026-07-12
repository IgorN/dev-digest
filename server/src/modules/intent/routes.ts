import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Intent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * Intent module — derives a PR's intent/scope before the main review runs.
 *   POST /pulls/:id/intent/recompute → synchronous, single LLM call, persists
 *                                       and returns the fresh Intent
 *   GET  /pulls/:id/intent           → the persisted Intent, or null when
 *                                       never computed for this PR (200, not
 *                                       404 — the client's EmptyState reads
 *                                       this as a plain falsy check, not an
 *                                       error-boundary case; see Risks in
 *                                       .claude/plans/intent-layer.md)
 *
 * Route shape mirrors `conventions`'s `POST /repos/:id/conventions/extract`
 * (fully synchronous, one cheap LLM call — design decision E), not
 * `repo-intel`'s async-queued pattern.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.post(
    '/pulls/:id/intent/recompute',
    { schema: { params: IdParams, body: z.object({}) } },
    async (req): Promise<Intent> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.recompute(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams } },
    async (req): Promise<Intent | null> => {
      const { workspaceId } = await getContext(app.container, req);
      const intent = await service.get(workspaceId, req.params.id);
      return intent ?? null;
    },
  );
}
