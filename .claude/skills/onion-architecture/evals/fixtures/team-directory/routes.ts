import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { TeamDirectoryService } from './service.js';

const SyncBody = z.object({ org: z.string() });

export default async function teamDirectoryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new TeamDirectoryService(app.container);

  app.post('/team-directory/sync', { schema: { body: SyncBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.sync(workspaceId, req.body.org);
  });
}
