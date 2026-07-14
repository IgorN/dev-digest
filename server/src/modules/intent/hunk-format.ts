import type { DiffHunk, UnifiedDiff } from '@devdigest/shared';

/**
 * Hunk-header synthesis for the intent classifier's input (design decision C).
 *
 * `DiffHunk` carries only numeric boundaries (`{oldStart, oldLines, newStart,
 * newLines}`) — no line-body text — so synthesizing the standard unified-diff
 * header format `@@ -a,b +c,d @@` here requires NO changes to `DiffHunk`,
 * `parseUnifiedDiff`, or any shared/vendored type. This is deliberately just
 * the header shape, never the +/- line bodies: the classifier must never see
 * diff content, only "what changed where" at the file/hunk-boundary level.
 */
export function formatHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/**
 * One line per file: the path followed by every synthesized hunk header for
 * that file, space-joined. No diff body text anywhere in the output.
 */
export function formatFileHunkLines(diff: UnifiedDiff): string[] {
  return diff.files.map((f) => {
    const headers = f.hunks.map(formatHunkHeader).join(' ');
    return headers.length > 0 ? `${f.path}: ${headers}` : f.path;
  });
}
