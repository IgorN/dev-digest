import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff module — classifies a PR's changed files by risk role
 * (core/wiring/boilerplate) and recomposes them with the LATEST
 * non-dismissed review findings per agent. Zero model-provider calls of any
 * kind: the reviewer's LLM call already happened when the review ran, so
 * this route is pure synchronous DB-read + pure-function composition (see
 * `SmartDiffService`) — nothing here reaches an LLM adapter.
 *
 *   GET /pulls/:id/smart-diff → the SmartDiff for the PR's CURRENT files.
 *                                Recomputed on every call, never cached
 *                                (Design decision C — no `smart_diff` table,
 *                                unlike the other `PrBrief` building blocks).
 *
 * Route shape mirrors `intent`'s `GET /pulls/:id/intent` exactly.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}
