/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "onboarding-tour", label: "Onboarding Tour", icon: "Play", href: "/repos/:repoId/onboarding", gKey: "o" },
      { key: "context", label: "Project Context", icon: "Folder", href: "/context", gKey: "x" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/conventions", gKey: "c" },
      { key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval", gKey: "e" },
    ],
  },
  {
    section: "GLOBAL",
    items: [
      // href points at the CONDITIONAL entry point, so a returning user lands on
      // their last multi-run result rather than a blank form.
      // `key` must stay "multi-agent" — it is consumed by shell.json's
      // `nav.multi-agent` and by activeKeyFor() in app-shell/helpers.ts.
      // Icon is "Users" per the design (chrome.jsx:17) — NOT "Cpu", which the
      // Agents entry already owns; two identical glyphs in one sidebar read as
      // a bug.
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/multi-agent-review", gKey: "m" },
      // `key` must stay "ci-runs" — the other two legs of the nav triad already
      // ship it: shell.json's `nav.ci-runs` (which the command palette reads via
      // t(`nav.${it.key}`)) and activeKeyFor() in app-shell/helpers.ts. Spelling
      // it "ciRuns"/"ci_runs" here breaks only at RUNTIME (MISSING_MESSAGE on
      // every page + a sidebar item that never highlights).
      // Label/icon come from the design (chrome.jsx:19). `gKey: "i"` was free.
      { key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs", gKey: "i" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "g x", label: "Go to Project Context", group: "Navigation" },
  { keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" },
  { keys: "g e", label: "Go to Eval Dashboard", group: "Navigation" },
  { keys: "g m", label: "Go to Multi-Agent Review", group: "Navigation" },
  { keys: "g i", label: "Go to CI Runs", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
