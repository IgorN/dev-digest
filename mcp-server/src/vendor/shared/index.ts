/**
 * @devdigest/mcp's vendored slice of @devdigest/shared. Mirrors the
 * server/src/vendor/shared and client/src/vendor/shared convention: a
 * hand-synced, minimal copy — not the full upstream package. Extend by
 * copying more fields from the upstream contract, never by importing
 * `@devdigest/shared` directly (this package has no workspace link to it).
 */
export * from './findings.js';
export * from './agent.js';
export * from './run.js';
export * from './platform.js';
export * from './knowledge.js';
