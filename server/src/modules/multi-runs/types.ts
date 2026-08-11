/**
 * Internal input shapes for the PURE grouping computation (`grouping.ts`).
 *
 * Deliberately NOT the vendored contract types and NOT Drizzle row types: the
 * grouping function is the module's domain core and must stay callable from a
 * unit test with hand-written literals, with no database, no `container` and no
 * contract parsing in the way. `service.ts` maps rows into these shapes.
 */

/** One finding as the grouping computation needs to see it. */
export interface GroupingFinding {
  /** Persisted finding id — the final, fully deterministic tie-break (AC-9). */
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  /** `findings.severity` is `text` in the DB; ranked via `SEVERITY_RANK`. */
  severity: string;
  title: string;
  /** Markdown; collapsed to one clipped line for a flagging cell (AC-11). */
  rationale: string;
  /** 0..1 — the first tie-break after severity (AC-9). */
  confidence: number;
}

/**
 * One participating agent's lane. The ARRAY ORDER of these is the multi-run's
 * authoritative agent order: it drives cell order (AC-10, AC-59), the label's
 * agent tie-break (AC-9) and the client's accent-colour assignment (AC-52).
 */
export interface GroupingAgent {
  /**
   * Stable per-lane key echoed into every verdict cell's `agent_id`. The agent
   * id when the agent row still exists; the RUN id as the fallback for a
   * deleted agent (`agent_runs.agent_id` is `on delete set null`, but
   * `MultiRunVerdictCell.agent_id` is a required string and cells must stay
   * positionally aligned with the `agents` array).
   */
  cellKey: string;
  /** Raw `agent_runs.status`; only `'done'` is a successful terminal run. */
  status: string | null;
  findings: GroupingFinding[];
}
