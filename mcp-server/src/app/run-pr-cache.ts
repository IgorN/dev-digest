/**
 * In-memory `run_id -> pr_id` cache (application ring, no I/O). Exists only
 * because the upstream API has no `GET /runs/:id` (approved-plan GAP-D) — the
 * MCP layer has to remember which PR a run belongs to between
 * `run_agent_on_pr` and a later `get_findings` call.
 *
 * KNOWN LIMITATION (flagged in the approved plan as risk/assumption A4): this
 * cache is process-local. If the MCP server restarts between the two calls,
 * `get_findings` cannot resolve the run and reports it as not found. Closing
 * this gap for real needs a `GET /runs/:id` endpoint on the server
 * (Stage 5 / later, not this v1).
 */
export class RunPrCache {
  private readonly runToPr = new Map<string, string>();

  remember(runId: string, prId: string): void {
    this.runToPr.set(runId, prId);
  }

  prFor(runId: string): string | undefined {
    return this.runToPr.get(runId);
  }
}
