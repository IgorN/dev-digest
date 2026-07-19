/** Pure helpers for OnboardingView. */
import { githubBlobUrl } from "@/lib/github-urls";
import type { IconName } from "@devdigest/ui";
import type { Repo } from "@/lib/types";
import type { Onboarding, OnboardingSection } from "@devdigest/shared";

/** Stable DOM id for a section, used both as the scroll anchor and the
   IntersectionObserver target for the "On this page" scroll-spy. */
export function sectionAnchorId(kind: string): string {
  return `onboarding-${kind}`;
}

/** Map each known section `kind` → a real `@devdigest/ui` IconName (verified to
   exist in the icon registry). Unknown kinds fall back to a generic file icon. */
const SECTION_ICON: Record<string, IconName> = {
  architecture: "Boxes",
  "critical-paths": "Activity",
  "run-locally": "Command",
  "reading-path": "ListChecks",
  "first-tasks": "Target",
};
export function sectionIcon(kind: string): IconName {
  return SECTION_ICON[kind] ?? "FileText";
}

/** Pull the FIRST fenced code block out of a markdown body so run-locally can
   render each command as its own copyable row. Returns the surrounding prose
   (everything OUTSIDE the block, trimmed) plus the non-empty command lines, or
   null when there is no code block (caller then falls back to Markdown). */
export function extractCommands(
  body: string,
): { prose: string; commands: string[] } | null {
  const match = /```[^\n]*\n([\s\S]*?)```/.exec(body);
  if (!match || match[1] == null) return null;
  const commands = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (commands.length === 0) return null;
  const prose = (body.slice(0, match.index) + body.slice(match.index + match[0].length)).trim();
  return { prose, commands };
}

/** Resolve the copyable command rows for a `run-locally` section, in precedence
   order:
     1. the STRUCTURED `commands` array (the contract field the server now emits;
        `body` then carries narration only, so the whole body is the prose), then
     2. the legacy first-fenced-code-block parse, so tours generated BEFORE the
        field existed keep rendering rows instead of silently degrading, then
     3. null → caller falls back to the plain Markdown body.
   The structured branch wins even when the body also happens to contain a code
   block: the typed field is what the output schema enforces, the block isn't. */
export function resolveCommands(
  section: OnboardingSection,
): { prose: string; commands: string[] } | null {
  const structured = (section.commands ?? []).map((c) => c.trim()).filter(Boolean);
  if (structured.length > 0) return { prose: section.body.trim(), commands: structured };
  return extractCommands(section.body);
}

/** Compact "time ago" for the "last refreshed" line — derived from the payload's
   `generated_at` on every render, never stored in component state (AC-19). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** A tour is "degraded" for badge purposes when its index_state is present and
   anything other than `full` (AC-14). A null index_state (old rows with no
   metadata) is treated as not-degraded — no scary badge for missing data. */
export function isDegraded(tour: Onboarding): boolean {
  return tour.index_state != null && tour.index_state !== "full";
}

/** Resolve an OnboardingLink path to the real repo file on GitHub, pinned to the
   repo's default branch. Returns undefined when the repo isn't resolved yet so
   the link degrades to plain text rather than a broken href (AC-20). */
export function fileUrl(repo: Repo | null, path: string): string | undefined {
  if (!repo?.full_name) return undefined;
  return githubBlobUrl(repo.full_name, repo.default_branch, path);
}
