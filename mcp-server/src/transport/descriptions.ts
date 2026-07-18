/**
 * Transport ring — the exact tool `description` strings agreed in the
 * approved Development Plan (section 6). Short, declarative, non-imperative
 * (MCP security guidance treats descriptions as untrusted-input surface —
 * keep them free of instructions a client should blindly follow), each
 * states what NOT to use the tool for and any latency/cost caveat.
 */

export const LIST_AGENTS_DESCRIPTION =
  "List the configured review agents (review profiles) available in this DevDigest workspace. " +
  "Returns each agent's human-readable name, description, provider and model. " +
  "Call this first when you need a valid value for the `agent` parameter of run_agent_on_pr, " +
  "or when the user asks which agents/review profiles exist. " +
  "Do NOT call this to read review results (use get_findings) and do NOT call it repeatedly in a loop — the list is stable within a session. " +
  "Read-only and fast; no side effects.";

export const RUN_AGENT_ON_PR_DESCRIPTION =
  "Start a review of one pull request by one agent and return a self-contained outcome. " +
  "Identify the PR by `repo` (\"owner/repo\") and `pr_number`, and the agent by its name or id from list_agents. " +
  "Reviews run asynchronously and can take minutes: this tool waits briefly (wait_seconds, default 6, max 20). " +
  "If the review finishes within that window it returns the verdict and findings inline; otherwise it returns a `run_id` " +
  "and status \"running\" — then call get_findings with that run_id to poll for the result. " +
  "This can trigger an expensive LLM run and is rate-limited (10/min). " +
  "Do NOT call this just to read existing results (use get_findings) and do NOT call it in a loop to poll. " +
  "If the agent or PR is not found, the error tells you the next step (e.g. call list_agents).";

export const GET_FINDINGS_DESCRIPTION =
  "Fetch the results of an already-started review run by its `run_id` (from run_agent_on_pr). " +
  "Returns the run status, an overall verdict, and a concise list of findings " +
  "(severity, category, title, file, line, suggestion). Optionally filter by `severity` or `category` and cap with `limit` (default 20). " +
  "Status \"running\" is a normal response, not an error — poll again in a few seconds. " +
  "Call this after run_agent_on_pr returns status \"running\", or to re-read a previous run's findings. " +
  "Do NOT call this to start a review, and do NOT call it without a run_id. Read-only.";

export const GET_CONVENTIONS_DESCRIPTION =
  "Return the repository's established (accepted) coding conventions for `repo` (\"owner/repo\"): " +
  "each rule with its category, the evidence file path, and a confidence score. " +
  "By default only accepted conventions are returned; set include_candidates=true to also see unreviewed candidates. " +
  "Call this before reviewing or judging a PR against team rules, or when the user asks what conventions the repo follows. " +
  "If the repo has not been scanned yet you get an empty list with scanned=false (not an error). " +
  "Do NOT use this to start convention extraction (a separate expensive operation) or to read review findings. Read-only.";

export const GET_BLAST_RADIUS_DESCRIPTION =
  "Report the blast radius (impact scope) of a pull request identified by `repo` and `pr_number`. " +
  "NOTE: this analysis is NOT implemented yet. This tool performs no analysis and infers no data; " +
  "it always returns status \"not_implemented\", implemented=false, and an empty `affected` list. " +
  "Only call it if the user explicitly asks for blast-radius, so you can truthfully report the feature is not yet available. " +
  "Do NOT treat the empty result as \"the change affects nothing\" and do NOT base any decision on its output.";
