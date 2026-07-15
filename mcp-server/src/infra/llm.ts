/**
 * Infrastructure ring — constructs the SAME `LLMProvider` implementation the
 * product uses (`reviewer-core`'s `OpenRouterProvider`), directly from an env
 * var. No `container`/DB/secrets-provider involved — this CLI has no
 * workspace concept, so the user's own OpenRouter key drives it.
 */
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'OPENROUTER_API_KEY is not set. Export it in your shell before running `devdigest review` ' +
        '(the same key configured in DevDigest\'s Settings for the OpenRouter provider).',
    );
    this.name = 'MissingApiKeyError';
  }
}

export function buildLlmProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  return new OpenRouterProvider(apiKey);
}
