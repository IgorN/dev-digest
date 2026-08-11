/* Constants for the shared EvalCaseEditor (L06 — Eval Pipeline). */

/** Skeleton expectation item appended by the "+ Finding skeleton" helper
   button — a hand-authoring shortcut for the informal `expected_output`
   item shape (`server/src/modules/eval/types.ts`'s `ExpectationItem`). Kept
   exactly as specified by the reference design (no `type` field pre-filled —
   the author picks must_find/must_not_flag by editing the JSON directly). */
export const FINDING_SKELETON = {
  severity: "CRITICAL",
  category: "security",
  title: "",
  file: "",
  start_line: 0,
} as const;

/** "Run on save" defaults ON per the reference design screenshot. */
export const DEFAULT_RUN_ON_SAVE = true;

export const MODAL_WIDTH = 720;

export type InputTabKey = "diff" | "files" | "prMeta";
