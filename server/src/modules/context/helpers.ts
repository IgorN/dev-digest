import { TRUNCATION_MARKER } from './constants.js';

/**
 * Pure domain helpers for Project Context documents. NO I/O — deliberately
 * importable from any module (context reader here; agents/skills save-time
 * validation and reviews run-assembly reuse `isPathSafe`/`approxTokens`/
 * `truncateToBytes` so there is exactly ONE estimator and ONE path guard).
 */

/**
 * Deterministic token estimator: ~1 token per 4 characters (AC-14/AC-12 share
 * this so the editor's set estimate and the trace per-doc size are comparable).
 */
export function approxTokens(len: number): number {
  if (!Number.isFinite(len) || len <= 0) return 0;
  return Math.ceil(len / 4);
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * Cap `content` at `cap` UTF-8 BYTES (not chars), never splitting a multi-byte
 * code point, and append a visible truncation marker when the cap hit (AC-18).
 */
export function truncateToBytes(content: string, cap: number): TruncateResult {
  const buf = Buffer.from(content, 'utf8');
  if (buf.byteLength <= cap) return { text: content, truncated: false };
  // Walk back off any UTF-8 continuation byte (0b10xxxxxx) so the cut lands on
  // a code-point boundary instead of emitting a U+FFFD replacement char.
  let end = Math.max(cap, 0);
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString('utf8') + TRUNCATION_MARKER, truncated: true };
}

/**
 * Lexical repo-relative path guard (AC-19). Rejects anything that could
 * address a file outside the clone root: empty paths, absolute paths (POSIX
 * or Windows drive), backslashes, NUL bytes, and `.`/`..`/empty segments.
 * Purely lexical — run-time symlink escapes are refused inside the git
 * adapter itself (`SimpleGitClient.readFile` realpath-containment throws),
 * which callers treat as missing/unreadable, never as reads outside the clone.
 */
export function isPathSafe(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

/** A context document is a markdown file (case-insensitive `.md`). */
export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * The configured root DIRECTORY name a path sits under, at any depth — or null.
 * Only directory segments count: a file named `docs.md` does not match `docs`.
 * When several segments match, the shallowest wins (its badge is shown).
 */
export function matchRoot(path: string, roots: readonly string[]): string | null {
  if (roots.length === 0) return null;
  const rootSet = new Set(roots);
  const segments = path.split('/');
  for (const seg of segments.slice(0, -1)) {
    if (rootSet.has(seg)) return seg;
  }
  return null;
}
