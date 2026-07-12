import type { PrFile, SmartDiffFile } from "@/lib/types";

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
