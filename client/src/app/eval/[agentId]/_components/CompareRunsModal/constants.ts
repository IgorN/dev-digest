/** Modal width — wide enough for a 4-up delta row + a readable prompt diff
   panel without wrapping every line. */
export const MODAL_WIDTH = 840;

/** Diff panel scroll cap — prompts can run long; keep the modal itself from
   growing unbounded (Modal already caps at 92% viewport height, but a very
   long prompt would otherwise push the Promote footer off-screen). */
export const DIFF_PANEL_MAX_HEIGHT = 320;
