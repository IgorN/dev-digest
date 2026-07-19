import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /context (Project Context). Thin route entry — the inventory list,
   markdown preview pane, styles and helpers are colocated under
   _components/ProjectContextView. Scoped to the active repo. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
