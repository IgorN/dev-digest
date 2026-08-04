import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  WorkflowRunMeta,
  ArtifactMeta,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import {
  GitHubActionsScopeError,
  GitHubArtifactTooLargeError,
  GitHubWorkflowScopeError,
  httpStatusOf,
  isWorkflowScopeRefusal,
} from './errors.js';

const TIMEOUT = 30_000;

/** Downloading an artifact is the one call whose body can be large. */
const ARTIFACT_TIMEOUT = 60_000;

/** Default ceiling on a downloaded artifact when the caller names none. */
const DEFAULT_ARTIFACT_MAX_BYTES = 256 * 1024;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * ONE atomic commit onto `branch`: blob per file → tree → commit → ref.
   *
   * Repaired for its first production consumer (Export-to-CI); before that it
   * had zero callers anywhere in the repository:
   *  - it never created blobs, inlining every file's text into a single
   *    `createTree` body. The export's first commit carries ~1.6 MB of runner
   *    bundle — exactly the case blob-first exists to avoid;
   *  - a bare `catch` around `getRef(heads/<branch>)` treated ANY failure
   *    (a 403, a network blip) as "the branch does not exist", so an auth
   *    failure silently became a first install off the base branch;
   *  - `updateRef` forced. The parent IS the branch's own tip, so the update is
   *    a fast-forward; `force: true` only makes a concurrent-write race
   *    silently destructive.
   */
  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          try {
            // Parent commit: the target branch if it already exists, else the base.
            let parentSha: string;
            let branchExists = false;
            try {
              const ref = await g.getRef({
                owner,
                repo: name,
                ref: `heads/${payload.branch}`,
              });
              parentSha = ref.data.object.sha;
              branchExists = true;
            } catch (err) {
              // ONLY a genuine 404 means "branch not there yet". Anything else
              // (403, 5xx, network) is a real failure and must not be masked as
              // a first install.
              if (httpStatusOf(err) !== 404) throw err;
              const baseRef = await g.getRef({
                owner,
                repo: name,
                ref: `heads/${payload.base}`,
              });
              parentSha = baseRef.data.object.sha;
            }

            // Blobs first — the tree then references them by sha, so no request
            // body carries the bundle's bytes. Sequential on purpose: GitHub
            // applies secondary rate limits to concurrent mutating requests.
            const shas: string[] = [];
            for (const file of payload.files) {
              const blob = await g.createBlob({
                owner,
                repo: name,
                content: Buffer.from(file.contents, 'utf8').toString('base64'),
                encoding: 'base64',
              });
              shas.push(blob.data.sha);
            }

            // New tree layered on the parent's tree (so unrelated files are kept).
            const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
            const tree = await g.createTree({
              owner,
              repo: name,
              base_tree: parentCommit.data.tree.sha,
              tree: payload.files.map((f, i) => ({
                path: f.path,
                mode: '100644' as const,
                type: 'blob' as const,
                sha: shas[i]!,
              })),
            });

            const commit = await g.createCommit({
              owner,
              repo: name,
              message: payload.message,
              tree: tree.data.sha,
              parents: [parentSha],
            });

            if (branchExists) {
              await g.updateRef({
                owner,
                repo: name,
                ref: `heads/${payload.branch}`,
                sha: commit.data.sha,
                force: false,
              });
            } else {
              await g.createRef({
                owner,
                repo: name,
                ref: `refs/heads/${payload.branch}`,
                sha: commit.data.sha,
              });
            }
            return { branch: payload.branch };
          } catch (err) {
            // Writing anything under `.github/workflows/` needs the SEPARATE
            // `workflow` scope; a token with only `repo` gets a 403 here that
            // otherwise reads as an unexplained commit error.
            if (isWorkflowScopeRefusal(err)) throw new GitHubWorkflowScopeError(err);
            throw err;
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  // ---------- Actions (read-only; Export-to-CI ingest) ----------

  /**
   * A 403 from ANY Actions call means the token lacks `Actions: read` — a scope
   * the export/commit path does not need. Surfacing that distinctly (AC-43) is
   * the difference between "add Actions read to your token" and a dead end.
   */
  private mapActionsError(err: unknown): never {
    if (httpStatusOf(err) === 403) throw new GitHubActionsScopeError(err);
    throw err;
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    limit: number,
  ): Promise<WorkflowRunMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const res = await this.octokit.rest.actions.listWorkflowRuns({
              owner: repo.owner,
              repo: repo.name,
              // The Actions API addresses a workflow by its FILE NAME.
              workflow_id: workflowFile,
              per_page: Math.min(Math.max(limit, 1), 100),
            });
            // GitHub returns newest first; the slice is the AC-44 bound.
            return res.data.workflow_runs.slice(0, limit).map((run) => ({
              id: String(run.id),
              status: run.status ?? null,
              conclusion: run.conclusion ?? null,
              html_url: run.html_url,
              created_at: run.created_at,
              updated_at: run.updated_at,
              run_started_at: run.run_started_at ?? null,
              display_title: run.display_title ?? null,
              pull_number: run.pull_requests?.[0]?.number ?? null,
            }));
          } catch (err) {
            // A workflow file that has never run yet 404s — that is "no runs",
            // not a failure, and must not abort the whole Refresh.
            if (httpStatusOf(err) === 404) return [];
            return this.mapActionsError(err);
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  async listRunArtifacts(repo: RepoRef, runId: string): Promise<ArtifactMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const res = await this.octokit.rest.actions.listWorkflowRunArtifacts({
              owner: repo.owner,
              repo: repo.name,
              run_id: Number(runId),
              per_page: 100,
            });
            return res.data.artifacts.map((a) => ({
              id: String(a.id),
              name: a.name,
              size_in_bytes: a.size_in_bytes,
              expired: Boolean(a.expired),
            }));
          } catch (err) {
            if (httpStatusOf(err) === 404) return [];
            return this.mapActionsError(err);
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * The artifact download is a redirect Octokit follows; the body is a ZIP
   * (never the JSON) and it is UNTRUSTED input produced inside someone else's
   * CI, so it is refused above `maxBytes` rather than buffered. Extraction is
   * the ci module's `archive.ts`, not the adapter's.
   */
  async downloadArtifact(
    repo: RepoRef,
    artifactId: string,
    maxBytes: number = DEFAULT_ARTIFACT_MAX_BYTES,
  ): Promise<Uint8Array> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const res = await this.octokit.rest.actions.downloadArtifact({
              owner: repo.owner,
              repo: repo.name,
              artifact_id: Number(artifactId),
              archive_format: 'zip',
            });
            const bytes = new Uint8Array(res.data as ArrayBuffer);
            if (bytes.byteLength > maxBytes) {
              throw new GitHubArtifactTooLargeError(bytes.byteLength, maxBytes);
            }
            return bytes;
          } catch (err) {
            if (err instanceof GitHubArtifactTooLargeError) throw err;
            return this.mapActionsError(err);
          }
        })(),
        ARTIFACT_TIMEOUT,
      ),
    );
  }
}
