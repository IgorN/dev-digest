import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type WebhookDeliveryRow = typeof t.webhookDeliveries.$inferSelect;

export class WebhookRepository {
  constructor(private db: Db) {}

  async findByDeliveryId(deliveryId: string): Promise<WebhookDeliveryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.webhookDeliveries)
      .where(eq(t.webhookDeliveries.deliveryId, deliveryId));
    return row;
  }

  async insert(values: {
    workspaceId: string;
    deliveryId: string;
    eventType: string;
    payload: unknown;
  }): Promise<WebhookDeliveryRow> {
    const [row] = await this.db.insert(t.webhookDeliveries).values(values).returning();
    return row;
  }
}
