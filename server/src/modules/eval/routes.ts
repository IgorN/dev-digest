import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  EvalCaseInput,
  EvalRunBatchInput,
  type EvalCase,
  type EvalCaseWithLatestRun,
  type EvalDashboard,
  type EvalRunBatchResponse,
  type EvalWorkspaceDashboard,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * Eval module — turn accepted/dismissed findings (or hand-authored cases)
 * into a reusable, fixed-input regression set for an agent, run it through
 * the SAME `reviewer-core` path a live PR uses, and score it 100% in code.
 *
 *   POST   /findings/:id/eval-case     → one-click case-from-finding
 *   GET    /agents/:id/eval-cases      → list an agent's cases
 *   POST   /agents/:id/eval-cases      → hand-author a new case for an agent
 *   GET    /eval-cases/:id             → one case
 *   PUT    /eval-cases/:id             → persist-only field update
 *   DELETE /eval-cases/:id             → delete a case (+ its runs, cascade)
 *   POST   /agents/:id/eval-runs       → run a batch (all cases, or `case_ids`)
 *   GET    /agents/:id/eval-dashboard  → one agent's dashboard
 *   GET    /eval-dashboard             → workspace-wide index (every agent)
 *   POST   /eval-dashboard/run-all     → run every enabled agent w/ ≥1 case
 *
 * Every route resolves `workspaceId` via `getContext` and 404s (never leaks)
 * on a cross-workspace id (AC-39) — enforced by `EvalService`/`EvalRepository`,
 * never by a Drizzle query here (routes never touch the repository directly).
 */

/** Client-facing case-create body: `owner_kind`/`owner_id` are OMITTED — the
 *  server sets both from the `:id` path param (`'agent'`) rather than trusting
 *  the client to supply them. */
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

/** Persist-only partial update — same shape, every field optional. No
 *  "run on save" flag: the client makes a separate, explicit run-batch call
 *  after a successful save instead of relying on an untyped server trigger. */
const UpdateEvalCaseBody = CreateEvalCaseBody.partial();

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- Case-from-finding (AC-1/AC-2/AC-3/AC-4/AC-5) -----------------------
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams } },
    async (req, reply): Promise<EvalCase> => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.createCaseFromFinding(workspaceId, req.params.id);
      reply.status(201);
      return evalCase;
    },
  );

  // ---- Hand-authored case CRUD ---------------------------------------------
  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req): Promise<EvalCaseWithLatestRun[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCasesForAgent(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply): Promise<EvalCase> => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.createAgentCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams } },
    async (req): Promise<EvalCase> => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.getCase(workspaceId, req.params.id);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody } },
    async (req): Promise<EvalCase> => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams } },
    async (req): Promise<{ ok: true }> => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  // ---- Run a batch (AC-11/AC-12/AC-13/AC-20/AC-21) -------------------------
  // Rate-limited like `POST /pulls/:id/review` (reviews/routes.ts) — each call
  // fans out to one paid LLM call per targeted case.
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, body: EvalRunBatchInput },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<EvalRunBatchResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runBatch(workspaceId, req.params.id, req.body.case_ids);
    },
  );

  // ---- Dashboards -----------------------------------------------------------
  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams } },
    async (req): Promise<EvalDashboard> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getAgentDashboard(workspaceId, req.params.id);
    },
  );

  app.get('/eval-dashboard', async (req): Promise<EvalWorkspaceDashboard> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getWorkspaceDashboard(workspaceId);
  });

  // Fans out further than a single agent's batch (every enabled agent × its
  // cases) — tighter cap than a single-agent run.
  app.post(
    '/eval-dashboard/run-all',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req): Promise<EvalWorkspaceDashboard> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runAllAgents(workspaceId);
    },
  );
}
