/** Per-symbol caller cap (concise, not a raw dump) — capped independently for
 *  EACH changed symbol, not globally across all of them. */
export const MAX_CALLERS_PER_SYMBOL = 20;

export const SUMMARY_SYSTEM_PROMPT =
  "You are explaining a pull request's blast radius (impact map) to a reviewer " +
  'in ONE short paragraph (2-4 sentences). Be concrete: name the changed ' +
  'symbols, how many callers/endpoints are affected, and the main risk if any. ' +
  'Plain prose, no markdown, no bullet points, no headings. If there is no ' +
  'downstream impact, say so plainly.';

export const NO_SYMBOLS_SUMMARY =
  'No indexed symbols were declared in the changed files, so no downstream impact could be mapped.';
