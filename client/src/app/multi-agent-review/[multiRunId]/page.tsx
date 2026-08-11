import { MultiRunView } from "../_components/MultiRunView";

/* Route: /multi-agent-review/<multiRunId> — one multi-run's result, addressed by
   its own id so the page is shareable and reloadable (AC-32); an unresolvable or
   cross-workspace id 404s and renders a not-found state (AC-64).

   `configure` is a STATIC sibling segment, which the App Router resolves ahead
   of this dynamic one — and since every multi-run id is a UUID, no real id can
   collide with the literal anyway. */
export default async function MultiRunResultPage({
  params,
}: {
  params: Promise<{ multiRunId: string }>;
}) {
  const { multiRunId } = await params;
  return <MultiRunView multiRunId={multiRunId} />;
}
