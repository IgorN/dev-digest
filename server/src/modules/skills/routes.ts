import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * Skills module — reusable, text-only review rules shared across agents.
 *   GET    /skills                 → list (workspace-scoped)
 *   GET    /skills/:id             → one skill
 *   POST   /skills                 → create (manual, or confirm-to-save an import)
 *   PUT    /skills/:id             → update / toggle enabled (body change versions)
 *   DELETE /skills/:id             → delete (cascades versions + agent links)
 *   POST   /skills/import          → parse an uploaded md/zip into a PREVIEW (no save)
 *
 * A skill runs nothing: it is a markdown `body` injected verbatim into an
 * agent's prompt. Linking skills to agents lives on the agents module
 * (POST /agents/:id/skills) — this module owns the skills themselves.
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
  version_message: z.string().nullish(),
});

/** Import upload: the file's bytes as base64 plus its name (binary-safe in JSON,
 *  so no multipart infra is needed and the endpoint stays trivially testable). */
const ImportBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const b = req.body;
    const skill = await service.create(workspaceId, {
      name: b.name,
      type: b.type,
      body: b.body,
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.source !== undefined ? { source: b.source } : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.evidence_files !== undefined ? { evidence_files: b.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/usage', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const usage = await service.usage(workspaceId, req.params.id);
    if (!usage) throw new NotFoundError('Skill not found');
    return usage;
  });

  app.post('/skills/import', { schema: { body: ImportBody } }, async (req) => {
    await getContext(app.container, req);
    // Buffer.from(.., 'base64') never throws — it silently drops invalid chars —
    // so validate the decoded result is non-empty instead of try/catching it.
    const bytes = Buffer.from(req.body.content_base64, 'base64');
    if (bytes.length === 0) throw new ValidationError('content_base64 decoded to no bytes');
    try {
      return service.parseImport(req.body.filename, bytes);
    } catch (err) {
      throw new ValidationError(`Could not import skill: ${(err as Error).message}`);
    }
  });
}
