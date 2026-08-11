import type { Container } from '../../platform/container.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { RepoRepository } from '../repos/repository.js';
import { TeamDirectoryRepository } from './repository.js';
import { toDirectoryMember } from './helpers.js';
import { GITHUB_ORG_TOKEN_SECRET } from './constants.js';

export class TeamDirectoryService {
  private repo: TeamDirectoryRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new TeamDirectoryRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  async sync(workspaceId: string, org: string): Promise<{ synced: number; reposLinked: number }> {
    const token = await this.container.secrets.get(GITHUB_ORG_TOKEN_SECRET);
    const github = new OctokitGitHubClient(token);
    const members = await github.listOrgMembers(org);

    for (const entry of members) {
      await this.repo.upsertMember(workspaceId, toDirectoryMember(entry));
    }

    const trackedRepos = await this.repos.list(workspaceId);
    return { synced: members.length, reposLinked: trackedRepos.length };
  }
}
