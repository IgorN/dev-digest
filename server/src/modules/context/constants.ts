/**
 * Project Context module constants. Runtime-tunable values (the root-directory
 * set and the per-document byte cap) live on AppConfig (`contextRoots`,
 * `contextDocMaxBytes`) — these are the fixed literals only.
 */

/** Visible marker appended to a document truncated at the byte cap (AC-18). */
export const TRUNCATION_MARKER =
  '\n\n[truncated: document exceeds the configured context size cap]';

/** Max accepted length for a preview `path` query param (defense in depth). */
export const MAX_DOCUMENT_PATH_LENGTH = 1024;
