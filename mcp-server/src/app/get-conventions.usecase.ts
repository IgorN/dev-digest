import type { DevDigestApi } from '../ports/devdigest-api.js';
import { McpToolError } from '../domain/errors.js';
import { filterConventions, type NarrowConvention } from '../domain/shape.js';

export interface GetConventionsInput {
  repo: string;
  include_candidates?: boolean;
  category?: string;
  limit?: number;
}

export interface GetConventionsOutput {
  repo: string;
  conventions: NarrowConvention[];
  scanned: boolean;
}

/** Application ring. Maps onto the real L03 conventions feature
 *  (`GET /repos/:id/conventions`, server/src/modules/conventions) — by
 *  default returns only ACCEPTED candidates (approved-plan A5); never
 *  triggers the separate, expensive `POST .../extract` pass. */
export function makeGetConventionsUseCase(deps: { api: DevDigestApi }) {
  return async function getConventions(input: GetConventionsInput): Promise<GetConventionsOutput> {
    const repos = await deps.api.listRepos();
    const repo = repos.find((r) => r.full_name === input.repo);
    if (!repo) {
      throw new McpToolError(
        'repo_not_found',
        `Repo '${input.repo}' not found in DevDigest — it must be added/imported in the app first.`,
      );
    }

    const { candidates, scanned_at } = await deps.api.listConventions(repo.id);
    return {
      repo: input.repo,
      conventions: filterConventions(candidates, {
        includeCandidates: input.include_candidates,
        category: input.category,
        limit: input.limit,
      }),
      scanned: scanned_at !== null,
    };
  };
}
