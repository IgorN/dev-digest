/** Confidence bar colour: high = ok (green), mid = warn (amber), low = muted. */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return "var(--ok)";
  if (confidence >= 0.7) return "var(--warn, #f59e0b)";
  return "var(--text-muted)";
}

/** `src/a.ts:23-31` (or `:23` when single-line, or just the path). */
export function evidenceLabel(path: string, start?: number | null, end?: number | null): string {
  if (!path) return "—";
  if (start == null) return path;
  return end && end !== start ? `${path}:${start}-${end}` : `${path}:${start}`;
}
