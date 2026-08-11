import type { FastifyReply } from 'fastify';
import type { Container } from '../../platform/container.js';
import { DigestSummaryRepository } from './repository.js';
import { pickTopHighlights, enrichWithAuthor } from './helpers.js';

export class DigestSummaryService {
  private repo: DigestSummaryRepository;

  constructor(private container: Container) {
    this.repo = new DigestSummaryRepository(container.db, container);
  }

  async generate(
    reply: FastifyReply,
    workspaceId: string,
    day: string,
    findings: { pullRequestId: string; title: string; severity: number }[],
  ) {
    const existing = await this.repo.findForDay(workspaceId, day);
    const top = pickTopHighlights(findings);
    const highlights = await enrichWithAuthor(this.container.db, top);
    const row = await this.repo.saveSummary(workspaceId, day, highlights);
    reply.status(existing ? 200 : 201);
    return row;
  }
}
