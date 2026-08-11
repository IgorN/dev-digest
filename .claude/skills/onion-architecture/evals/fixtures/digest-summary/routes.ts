import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestSummaryService } from './service.js';

export default async function digestSummaryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestSummaryService(app.container);

  app.post('/digest-summary/:day', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const findings = (req.body as {
      findings: { pullRequestId: string; title: string; severity: number }[];
    }).findings;
    return service.generate(reply, workspaceId, req.params.id, findings);
  });
}
