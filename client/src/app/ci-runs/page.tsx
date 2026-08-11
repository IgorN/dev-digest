import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs — every agent review that executed inside CI (never a local
   run). Thin Server Component entry; the interactive view (query, filter chips,
   Refresh/ingest mutation) lives in the Client Component leaf under
   _components/CiRunsView, mirroring the /eval route. */
export default function CiRunsPage() {
  return <CiRunsView />;
}
