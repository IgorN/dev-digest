import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify the `sha256=` HMAC signature GitHub attaches to a webhook payload. */
export function verifySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull the delivery id GitHub sends so retried deliveries can be deduped. */
export function extractDeliveryId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = headers['x-github-delivery'];
  return Array.isArray(value) ? value[0] : value;
}
