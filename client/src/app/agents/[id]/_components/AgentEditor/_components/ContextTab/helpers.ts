import type { DocumentInventoryItem } from "@devdigest/shared";

/** Pure helpers for the agent editor's Context tab. */

/** "server/docs/api/overview.md" → "overview.md". */
export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** "server/docs/api/overview.md" → "server/docs/api" ("" for a root-level file). */
export function folderPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

const ROOT_COLORS: Record<string, { color: string; bg: string }> = {
  specs: { color: "var(--info)", bg: "var(--info-bg)" },
  docs: { color: "var(--sugg)", bg: "var(--sugg-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};
const ROOT_DEFAULT = { color: "var(--text-secondary)", bg: "var(--bg-hover)" };

/** Badge colors per context root; unknown/custom roots get the neutral default. */
export function rootBadge(root: string): { color: string; bg: string } {
  return ROOT_COLORS[root] ?? ROOT_DEFAULT;
}

/** Move the item at `from` to `to` in a new array (pure). */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Deterministic total for the attached set: sum of each attached path's
 *  inventory `token_estimate` (0 for a path missing from the inventory). */
export function sumTokens(attached: string[], byPath: Map<string, DocumentInventoryItem>): number {
  return attached.reduce((acc, p) => acc + (byPath.get(p)?.token_estimate ?? 0), 0);
}
