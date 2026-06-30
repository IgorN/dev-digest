import { ConventionsView } from "./_components/ConventionsView";

/* Route: /conventions (Conventions Extractor). Thin route entry — the view, its
   candidate cards, the create-skill modal, styles, helpers and i18n are
   colocated under _components/ConventionsView. Scoped to the active repo. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
