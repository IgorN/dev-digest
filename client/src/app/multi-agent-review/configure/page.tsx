import { ConfigureRunView } from "../_components/ConfigureRunView";

/* Route: /multi-agent-review/configure — the Configure-run form at its explicit,
   directly navigable address. It renders the form ALWAYS, regardless of how many
   multi-runs the active repository has (AC-22c), and is the target of the result
   toolbar's `⚙ Configure run` (AC-33a). The conditional landing lives one
   segment up, in /multi-agent-review. */
export default function ConfigureMultiAgentRunPage() {
  return <ConfigureRunView />;
}
