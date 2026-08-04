import { MANIFEST_DIR, SKILLS_DIR, SLUG_FALLBACK } from './constants.js';

/**
 * DOMAIN CORE — pure slugging. No I/O, no clock, no randomness: the same input
 * must produce the same filenames on every regeneration, because the commit API
 * can add or replace a file but never delete one.
 */

/** Fallback used when a SKILL name yields an empty slug (AC-11). */
export const SKILL_SLUG_FALLBACK = 'skill';

/**
 * Lowercase, ASCII, hyphen-separated (AC-10). Latin diacritics are folded
 * (`Ünïcödé` → `unicode`) rather than dropped; a name with no ASCII-derivable
 * characters at all falls back to a deterministic identifier rather than
 * producing an empty filename (AC-11).
 */
export function slugify(name: string, fallback: string = SLUG_FALLBACK): string {
  const ascii = name
    .normalize('NFKD')
    // Strip combining marks left behind by NFKD (é → e + U+0301).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.length > 0 ? ascii : fallback;
}

/**
 * Slug a list of names, disambiguating collisions DETERMINISTICALLY BY ORDER
 * (AC-10): the first occurrence keeps the bare slug, the n-th gets `-n`. Order
 * is the agent's link order, so both the filenames and the manifest's `skills`
 * list stay in agreement and stable across repeated generations.
 */
export function uniqueSlugs(names: string[], fallback: string = SLUG_FALLBACK): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const name of names) {
    const base = slugify(name, fallback);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    // `-2`, `-3`, … — and if THAT collides with a literal existing slug, keep
    // walking until it does not, so the result is always unique.
    let candidate = n === 1 ? base : `${base}-${n}`;
    let bump = n;
    while (n > 1 && out.includes(candidate)) {
      bump += 1;
      candidate = `${base}-${bump}`;
    }
    out.push(candidate);
  }
  return out;
}

/** `.devdigest/agents/<slug>.yaml` — the path pinned at first install (AC-3). */
export function manifestPathFor(agentName: string): string {
  return `${MANIFEST_DIR}/${slugify(agentName)}.yaml`;
}

/** `.devdigest/skills/<slug>.md`. */
export function skillPathFor(slug: string): string {
  return `${SKILLS_DIR}/${slug}.md`;
}
