import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './constants.js';

/**
 * Classify a single PR-diff file by risk role, from its path alone.
 *
 * Pure, zero I/O (Design decision B: no `repo-intel` dependency — Smart Diff
 * is explicitly "by path/pattern", nothing else). Boilerplate is checked
 * BEFORE wiring so a lock file living under an otherwise wiring-looking
 * directory still classifies as boilerplate. Anything matching neither
 * pattern set defaults to `core` — fail toward MORE reviewer attention,
 * never less.
 */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((pattern) => pattern.test(path))) return 'wiring';
  return 'core';
}
