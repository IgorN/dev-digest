/** Pure helpers for ProjectContextView. */

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
