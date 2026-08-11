import { EntryPointView } from "./_components/EntryPointView";

/* Route: /multi-agent-review — the conditional entry point and the sidebar's
   target. Its client leaf resolves the active repository's latest multi-run in
   one round trip and renders EITHER that result view or the Configure-run form
   inline (AC-22, AC-22a, AC-22b). It deliberately does not redirect. */
export default function MultiAgentReviewPage() {
  return <EntryPointView />;
}
