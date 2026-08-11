/**
 * Multi-run module constants.
 */

/**
 * The ONE `agent_runs.status` value that counts as a SUCCESSFUL TERMINAL run —
 * the value `run-executor.ts` persists on the success path
 * (`completeAgentRun({ status: 'done', … })`). Anything else — `failed`,
 * `cancelled`, `running`, or a legacy null — is "no result", a state that is
 * deliberately DISTINCT from "did not flag" (AC-12 vs AC-13).
 */
export const SUCCESSFUL_RUN_STATUS = 'done';

/**
 * Severity → rank for "highest severity wins" comparisons (group label,
 * per-agent cell verdict). Higher number = more severe. Kept local to this
 * module: severities arrive from the DB as plain `text`, and this ordering is a
 * grouping concern, not a contract one.
 */
export const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/**
 * Max characters of a flagging agent's rationale carried into its verdict cell.
 * The design shows ONE muted line beside the verdict; the stored rationale is
 * markdown and can run to paragraphs, so it is collapsed and clipped here
 * rather than in the client (AC-11).
 */
export const CELL_RATIONALE_MAX_CHARS = 160;
