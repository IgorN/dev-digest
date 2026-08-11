import { EvalDashboardIndex } from "./_components/EvalDashboardIndex";

/* Route: /eval (workspace-wide Eval Dashboard index). Thin Server Component
   entry — the interactive view (queries, mutations, sparkline) lives in the
   Client Component leaf under _components/EvalDashboardIndex. */
export default function EvalDashboardPage() {
  return <EvalDashboardIndex />;
}
