/**
 * Webhooks module constants.
 */

/** Header GitHub sends with the HMAC signature for a webhook delivery. */
export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';

/** Header GitHub sends identifying the delivery event type. */
export const GITHUB_EVENT_HEADER = 'x-github-event';

/** JobRunner kind for processing an accepted webhook delivery asynchronously. */
export const PROCESS_DELIVERY_JOB_KIND = 'process_webhook_delivery';

/** Event types this module currently accepts. */
export const SUPPORTED_EVENTS = ['pull_request', 'push', 'installation'] as const;
