import type { CiRunStatus } from "@devdigest/shared";

/** Compact "time ago" for an installation's last-activity cell. Mirrors the
    onboarding tour's formatter; derived on every render, never stored. */
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

/** Badge colours per derived run status. `null` (no ingested run yet) is NOT in
    this map — the caller renders the explicit pending state instead (AC-58). */
const STATUS_COLOR: Record<CiRunStatus, { color: string; bg: string }> = {
  succeeded: { color: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: { color: "var(--ok)", bg: "var(--ok-bg)" },
  blocked: { color: "var(--warn)", bg: "var(--warn-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  running: { color: "var(--accent)", bg: "var(--accent-bg)" },
};

export function statusColors(status: CiRunStatus | null): { color: string; bg: string } {
  if (!status) return { color: "var(--text-muted)", bg: "var(--bg-hover)" };
  return STATUS_COLOR[status] ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };
}

/** `ci.runs.status.<key>` message key for a derived installation status. */
export function statusMessageKey(status: CiRunStatus): string {
  return status === "no_findings" ? "runs.status.noFindings" : `runs.status.${status}`;
}
