import { AppError } from '../../platform/errors.js';

/**
 * GitHub-specific failures that callers must distinguish from a generic 502.
 *
 * Both exist because a PAT's scopes are not all-or-nothing: a token can have
 * full repository access and still be rejected for exactly one operation, and
 * a generic "GitHub request failed" leaves the user with no way to act.
 */

/**
 * The Actions REST API returned 403 — the token lacks **Actions: read**.
 * The export/commit path does not need that scope and keeps working, so this
 * must never be collapsed into a generic failure (AC-43).
 */
export class GitHubActionsScopeError extends AppError {
  constructor(details?: unknown) {
    super(
      'github_actions_scope',
      'The configured GitHub token was rejected by the Actions API. It needs ' +
        '"Actions: read" access in addition to repository access — update the token ' +
        "in Settings and try Refresh again. (Exporting doesn't need this scope.)",
      403,
      details,
    );
    this.name = 'GitHubActionsScopeError';
  }
}

/**
 * GitHub refused to write under `.github/workflows/`. A classic PAT needs the
 * separate `workflow` scope (a fine-grained token needs Workflows: write) on
 * top of repository contents access, and the refusal arrives as a 403 on the
 * commit/ref call — which would otherwise read as an unexplained commit error.
 */
export class GitHubWorkflowScopeError extends AppError {
  constructor(details?: unknown) {
    super(
      'github_workflow_scope',
      'GitHub refused to commit the generated workflow file. The configured token ' +
        'needs the "workflow" scope (fine-grained: Workflows — read and write) in ' +
        'addition to repository contents write access. Nothing was committed.',
      403,
      details,
    );
    this.name = 'GitHubWorkflowScopeError';
  }
}

/**
 * The downloaded artifact exceeded the caller's byte ceiling. A 4xx on purpose:
 * `withRetry` treats 5xx as transient and would otherwise re-download an
 * oversized archive three more times.
 */
export class GitHubArtifactTooLargeError extends AppError {
  constructor(bytes: number, maxBytes: number) {
    super(
      'ci_artifact_too_large',
      `Result artifact is ${bytes} bytes, over the ${maxBytes}-byte limit.`,
      413,
    );
    this.name = 'GitHubArtifactTooLargeError';
  }
}

/** Octokit's `RequestError` shape, narrowed structurally (no import needed). */
export function httpStatusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/** True when GitHub's 403 is specifically the workflow-scope refusal. */
export function isWorkflowScopeRefusal(err: unknown): boolean {
  if (httpStatusOf(err) !== 403) return false;
  const message = String((err as { message?: string } | null)?.message ?? '');
  return /workflow/i.test(message) && /scope|permission|refus/i.test(message);
}
