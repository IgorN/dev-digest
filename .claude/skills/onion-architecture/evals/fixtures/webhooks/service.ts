import type { Container } from '../../platform/container.js';
import { WebhookRepository } from './repository.js';
import { PROCESS_DELIVERY_JOB_KIND } from './constants.js';

export class WebhookService {
  private repo: WebhookRepository;
  private webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? '';

  constructor(private container: Container) {
    this.repo = new WebhookRepository(container.db);
  }

  getSecret(): string {
    return this.webhookSecret;
  }

  async ingest(
    workspaceId: string,
    deliveryId: string,
    eventType: string,
    payload: unknown,
  ): Promise<{ accepted: boolean }> {
    const existing = await this.repo.findByDeliveryId(deliveryId);
    if (existing) return { accepted: false };
    await this.repo.insert({ workspaceId, deliveryId, eventType, payload });
    await this.container.jobs.enqueue(workspaceId, PROCESS_DELIVERY_JOB_KIND, { deliveryId });
    return { accepted: true };
  }
}
