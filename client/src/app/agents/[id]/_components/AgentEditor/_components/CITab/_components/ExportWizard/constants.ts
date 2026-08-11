import type { CiTarget, IconName, PostAs } from "./types";

/**
 * The four target cards (`design-src/screen_export.jsx:3-8`).
 *
 * Only GitHub Actions actually generates anything this iteration; the other
 * three render exactly as the design shows them but are visibly AND
 * programmatically unavailable, and selecting one is impossible (AC-64, AC-65).
 */
export const CI_TARGETS: readonly {
  key: CiTarget;
  icon: IconName;
  recommended?: boolean;
  available: boolean;
}[] = [
  { key: "gha", icon: "Workflow", recommended: true, available: true },
  { key: "circle", icon: "RefreshCw", available: false },
  { key: "jenkins", icon: "Settings", available: false },
  { key: "cli", icon: "Command", available: false },
];

/** Step indicator labels, in order — resolved through `ci.exportWizard.steps.*`. */
export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

/** `pull_request` event types the workflow can subscribe to. `opened` and
    `synchronize` are MANDATORY so the trigger set can never become empty
    (AC-74); only `reopened` toggles. */
export const MANDATORY_TRIGGERS = ["opened", "synchronize"] as const;
export const OPTIONAL_TRIGGERS = ["reopened"] as const;
export const ALL_TRIGGERS = [...MANDATORY_TRIGGERS, ...OPTIONAL_TRIGGERS] as const;

/** `Post results as` radios (`screen_export.jsx:80`). */
export const POST_AS_OPTIONS: readonly {
  value: PostAs;
  labelKey: string;
  recommended?: boolean;
}[] = [
  { value: "github_review", labelKey: "postAs.githubReview", recommended: true },
  { value: "pr_comment", labelKey: "postAs.prComment" },
  { value: "none", labelKey: "postAs.none" },
];

/** The only provider the CI runner constructs (AC-67). */
export const RUNNER_PROVIDER = "openrouter";

/** The Actions secret the generated workflow reads (AC-18). */
export const RUNNER_SECRET_NAME = "OPENROUTER_API_KEY";

/** Approximate size the vendored runner bundle adds to the target repository.
    Surfaced on the PREVIEW step, on the runner rows themselves, where the files
    it refers to are actually visible. */
export const RUNNER_BUNDLE_SIZE = "1.6 MB";

/** Provided by Actions on every run — the workflow never asks for it. */
export const GITHUB_TOKEN_SECRET_NAME = "GITHUB_TOKEN";

/** GitHub's own instructions for adding a repository secret. We link the real
    upstream doc rather than a DevDigest page that does not exist. */
export const ACTIONS_SECRETS_DOCS_URL =
  "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions#creating-secrets-for-a-repository";
