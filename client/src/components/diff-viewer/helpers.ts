/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

/** Stable per-(file, new/current-side line) DOM anchor id. Only "new" line
   numbers are addressable — a Finding's `start_line` (and therefore
   SmartDiffFile.finding_lines) always refers to the file's CURRENT content,
   so a pure deletion (no `newNo`) is never a valid target. Shared by CodeLine
   (sets the id on its row) and FileCard (looks it up via
   document.getElementById to scroll+highlight on a click-to-line instruction
   — see FileCard's targetLine/targetNonce props). `encodeURIComponent` keeps
   the id valid/unique even for paths with slashes or unusual characters;
   getElementById doesn't need CSS-selector-safe characters. */
export function diffLineElementId(path: string, line: number): string {
  return `diff-line::${encodeURIComponent(path)}::${line}`;
}

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}
