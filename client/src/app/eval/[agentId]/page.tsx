import { EvalAgentDrillIn } from "./_components/EvalAgentDrillIn";

/* Route: /eval/:agentId (per-agent Eval Dashboard drill-in, AC-33–AC-38).
   Thin Server Component entry, mirroring /eval/page.tsx's shell — the
   interactive view (queries, mutations, chart, checkbox selection) lives in
   the Client Component leaf under _components/EvalAgentDrillIn. */
export default async function EvalAgentDrillInPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <EvalAgentDrillIn agentId={agentId} />;
}
