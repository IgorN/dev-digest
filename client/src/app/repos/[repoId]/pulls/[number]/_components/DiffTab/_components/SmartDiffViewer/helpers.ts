import type { PrFile, ReviewRecord, Severity, SmartDiffFile } from "@/lib/types";

/** A SmartDiffFile joined with its full PrFile (recovers `patch`, which
   SmartDiffFile doesn't carry — the FileCard/CodeLine machinery needs it to
   render the actual lines). */
export interface JoinedFile {
  smart: SmartDiffFile;
  file: PrFile;
}

/** Join a group's SmartDiffFile[] against the full PrFile[] (by path) to
   recover `patch`. Preserves the server-returned order — do not re-sort. A
   SmartDiffFile with no PrFile match (stale/renamed) is silently dropped, not
   an error — mirrors the backend's own drop-don't-crash rule for findings
   whose file doesn't match. */
export function joinFiles(smartFiles: SmartDiffFile[], byPath: Map<string, PrFile>): JoinedFile[] {
  const out: JoinedFile[] = [];
  for (const smart of smartFiles) {
    const file = byPath.get(smart.path);
    if (file) out.push({ smart, file });
  }
  return out;
}

/** A "jump to this finding" instruction, threaded down to the one matching
   FileCard as targetLine/targetNonce. `nonce` lets the SAME file+line be
   clicked again and still re-trigger the scroll+highlight (mirrors
   ReviewRunAccordion's targetRunId/targetNonce). */
export interface JumpTarget {
  path: string;
  line: number;
  nonce: number;
}

/** Highest-first so a single per-line badge shows the worst issue on that line. */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/**
 * Per-line severity, purely for the inline row badge — deliberately mirrors
 * the SAME selection the backend uses for `SmartDiffFile.finding_lines`
 * (latest review PER AGENT, `kind==='review'` only, dismissed excluded) so
 * the badges shown here never disagree with the "N finding-lines" count
 * already displayed in the FileCard header. No SmartDiff contract change:
 * this reads the already-fetched `ReviewRecord[]` (same data FindingsTab
 * uses), not a new field on `SmartDiffFile`. `reviews` must be newest-first
 * (the shape `usePrReviews`/`GET /pulls/:id/reviews` already returns). Two+
 * findings on the same line keep the MOST severe one.
 */
export function buildLineSeverities(reviews: ReviewRecord[]): Map<string, Map<number, Severity>> {
  const seenAgent = new Set<string>();
  const survivingFindings = reviews
    .filter((r) => r.kind === "review")
    .filter((r) => {
      const key = r.agent_id ?? r.run_id ?? r.id;
      if (seenAgent.has(key)) return false;
      seenAgent.add(key);
      return true;
    })
    .flatMap((r) => r.findings)
    .filter((f) => f.dismissed_at == null);

  const byPath = new Map<string, Map<number, Severity>>();
  for (const f of survivingFindings) {
    const byLine = byPath.get(f.file) ?? new Map<number, Severity>();
    const current = byLine.get(f.start_line);
    if (!current || SEVERITY_RANK[f.severity] > SEVERITY_RANK[current]) {
      byLine.set(f.start_line, f.severity);
    }
    byPath.set(f.file, byLine);
  }
  return byPath;
}
