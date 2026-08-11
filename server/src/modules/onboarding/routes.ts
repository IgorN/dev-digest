import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Onboarding } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding tour module — a per-repo "first day" tour built from the repo-intel
 * index (transport ring).
 *   GET  /repos/:id/onboarding           -> { onboarding: Onboarding | null }
 *                                           the persisted tour, or null when
 *                                           never generated (200, not 404).
 *                                           Zero LLM calls (AC-1/AC-2).
 *   POST /repos/:id/onboarding/recompute -> { onboarding: Onboarding }
 *                                           synchronous; at most ONE LLM call,
 *                                           degrade-never-throw (AC-3/AC-11/AC-12).
 *
 * Envelope (`{ onboarding }`) per plan Rec-1 so the client hooks match. Route
 * param is `:id` (the repo UUID) per Rec-2, mirroring `context`/`conventions`.
 * Workspace scoping via `getContext` + the service's `getRepo` lookup (AC-21).
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams } },
    async (req): Promise<{ onboarding: Onboarding | null }> => {
      const { workspaceId } = await getContext(app.container, req);
      const onboarding = await service.get(workspaceId, req.params.id);
      return { onboarding: onboarding ?? null };
    },
  );

  app.post(
    '/repos/:id/onboarding/recompute',
    { schema: { params: IdParams, body: z.object({}) } },
    async (req): Promise<{ onboarding: Onboarding }> => {
      const { workspaceId } = await getContext(app.container, req);
      const onboarding = await service.recompute(workspaceId, req.params.id, req.log);
      return { onboarding };
    },
  );
}
