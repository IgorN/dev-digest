/**
 * Evidence verification for convention candidates — pure, no I/O.
 *
 * The model returns a short, distinctive ANCHOR it claims appears in the file
 * (a rule name, identifier, or config key) — NOT a multi-line snippet, because
 * models paraphrase/reformat multi-line code (quotes, semicolons, whitespace)
 * and verbatim matching is then flaky. We locate the anchor in the REAL file and
 * pull the actual surrounding lines as the evidence snippet, so what we persist
 * and show is always exact. A candidate whose anchor isn't found is DROPPED.
 */

export interface RawCandidate {
  category?: string | null;
  rule: string;
  evidence_path: string;
  /** A short, verbatim, distinctive string the model copied from the file. */
  evidence_anchor: string;
  confidence: number;
}

export interface VerifiedCandidate extends RawCandidate {
  /** The real file lines around the anchor (extracted here, not from the model). */
  evidence_snippet: string;
  evidence_start_line: number;
  evidence_end_line: number;
}

/** Anchors shorter than this are too common to trust as evidence. */
const MIN_ANCHOR = 4;
/** Cap the extracted snippet so a huge block doesn't dominate the card. */
const MAX_SNIPPET_LINES = 8;

const indentOf = (line: string): number => (line.match(/^\s*/)?.[0].length ?? 0);

/** Index of the first file line containing `anchor` (exact, then whitespace-
 *  normalized). Returns null when the anchor isn't present. */
function findAnchorLine(file: string[], anchor: string): number | null {
  const a = anchor.trim();
  if (a.length < MIN_ANCHOR) return null;
  for (let i = 0; i < file.length; i++) {
    if (file[i]!.includes(a)) return i;
  }
  const na = a.replace(/\s+/g, ' ');
  for (let i = 0; i < file.length; i++) {
    if (file[i]!.replace(/\s+/g, ' ').includes(na)) return i;
  }
  return null;
}

/** From the anchored line, take it plus its more-indented continuation lines
 *  (the rest of the statement/block), capped — reconstructs a multi-line rule
 *  from the real file. */
function extractSnippet(file: string[], start: number): { endLine: number; snippet: string } {
  const base = indentOf(file[start]!);
  const lines = [file[start]!];
  let end = start;
  for (let j = start + 1; j < file.length && lines.length < MAX_SNIPPET_LINES; j++) {
    const l = file[j]!;
    if (l.trim() === '') break;
    if (indentOf(l) <= base) break;
    lines.push(l);
    end = j;
  }
  return { endLine: end, snippet: lines.join('\n') };
}

/**
 * Keep only candidates whose anchor is real. Each survivor carries the actual
 * file snippet + its line range. Dedupes by (path, line).
 */
export function verifyCandidates(
  raw: RawCandidate[],
  files: Map<string, string>,
): VerifiedCandidate[] {
  const out: VerifiedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const content = files.get(c.evidence_path);
    if (!content) continue; // hallucinated / out-of-scope path
    const file = content.split('\n');
    const line = findAnchorLine(file, c.evidence_anchor);
    if (line == null) continue; // anchor not actually in the file
    const key = `${c.evidence_path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { endLine, snippet } = extractSnippet(file, line);
    out.push({
      ...c,
      evidence_snippet: snippet.trimEnd(),
      evidence_start_line: line + 1,
      evidence_end_line: endLine + 1,
    });
  }
  return out;
}
