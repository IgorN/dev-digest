import type { CiTarget } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

export type { CiTarget, IconName };

/** How the runner posts its result; travels to CI as `DEVDIGEST_POST_AS`. */
export type PostAs = "github_review" | "pr_comment" | "none";

/** Everything the wizard carries across its four steps and sends to the server.
    Held in ONE object on the wizard root so a Configure change can regenerate
    from an explicit next-config rather than from possibly-stale state. */
export interface WizardConfig {
  target: CiTarget;
  /** `owner/name`, chosen from the workspace's repositories (AC-66). */
  repo: string;
  triggers: string[];
  postAs: PostAs;
  /** The chosen repository's default branch — the base the CI branch forks from. */
  base: string;
}
