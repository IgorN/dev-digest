/** Constants for the conventions extractor. */

/** Cheap model used for the extraction pass (matches the seeded reviewer default). */
export const EXTRACTION_PROVIDER = 'openrouter' as const;
export const EXTRACTION_MODEL = 'deepseek/deepseek-v4-flash';

/** How many source files to sample (configs are added on top). */
export const SAMPLE_LIMIT = 12;
