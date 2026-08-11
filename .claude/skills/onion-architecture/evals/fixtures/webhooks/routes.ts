import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { WebhookService } from './service.js';
import { verifySignature, extractDeliveryId } from './helpers.js';
import { GITHUB_SIGNATURE_HEADER, GITHUB_EVENT_HEADER, SUPPORTED_EVENTS } from './constants.js';

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhookService(app.container);

  app.post('/webhooks/github', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const signature = req.headers[GITHUB_SIGNATURE_HEADER] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature, service.getSecret())) {
      return reply.status(401).send({ error: { code: 'invalid_signature', message: 'Signature verification failed' } });
    }

    const eventType = req.headers[GITHUB_EVENT_HEADER] as string;
    if (!SUPPORTED_EVENTS.includes(eventType as (typeof SUPPORTED_EVENTS)[number])) {
      return reply.status(202).send({ ignored: true });
    }

    const deliveryId = extractDeliveryId(req.headers) ?? '';
    const recent = await app.container.db
      .select()
      .from(t.webhookDeliveries)
      .where(eq(t.webhookDeliveries.deliveryId, deliveryId));

    if (recent.length > 0) {
      return { accepted: false };
    }

    const { accepted } = await service.ingest(workspaceId, deliveryId, eventType, req.body);
    reply.status(accepted ? 201 : 200);
    return { accepted };
  });
}
