import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type {
  EvalAgentSummary,
  EvalCase,
  EvalCaseWithLatestRun,
  EvalDashboard,
  EvalGlobalRunRow,
  EvalOwnerKind,
  EvalPerTrace,
  EvalRun,
  EvalRunBatchResponse,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
  EvalWorkspaceDashboard,
  Finding,
  LLMProvider,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { findingRowToDto } from '../reviews/helpers.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import {
  EvalRepository,
  type EvalCaseRow,
  type EvalRunBatchRow,
  type EvalRunBatchWithOwnerRow,
  type EvalRunRow,
} from './repository.js';
import {
  classifyExtraFindings,
  computeCitationAccuracy,
  computePrecision,
  computeRecall,
  matchExpectations,
} from './scoring.js';
import {
  buildExpectationFromFinding,
  resolveDisposition,
  selectNotableMetric,
  sliceDiffForFile,
} from './helpers.js';
import type { ExpectationItem } from './types.js';
import { DEFAULT_TREND_LIMIT, DEFAULT_WORKSPACE_TREND_LIMIT, MAX_CONCURRENT_CASE_REVIEWS } from './constants.js';

/** Client-facing case fields (`EvalCaseInput` minus the server-set
 *  `owner_kind`/`owner_id`) — shared shape for both create and (partial)
 *  update pass-throughs. */
export interface EvalCaseInputFields {
  name: string;
  input_diff?: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

/**
 * Eval — application service. The only place in this feature that calls
 * `reviewPullRequest` (never re-implementing review logic), and the only
 * place that must guarantee zero LLM-provider calls downstream of "findings
 * produced" (scoring, `scoring.ts`, is 100% pure code).
 *
 * Mirrors `blast`/`why-risk-brief`'s constructor shape: depends on
 * `Container`, constructs its own `ReviewRepository`/`EvalRepository` (no
 * dedicated repository existed for blast/why-risk-brief because they piggyback
 * on `ReviewRepository`; eval owns `eval_cases`/`eval_runs` so it gets its own).
 */
export class EvalService {
  private reviewRepo: ReviewRepository;
  private evalRepo: EvalRepository;

  constructor(private container: Container) {
    this.reviewRepo = new ReviewRepository(container.db);
    this.evalRepo = new EvalRepository(container.db);
  }

  // =========================================================================
  // Case-from-finding (AC-1/AC-2/AC-3/AC-4/AC-5)
  // =========================================================================

  /**
   * Turn an already-actioned (accepted/dismissed) finding into a reusable eval
   * case, scoped to the finding's OWN file and frozen at the current PR state.
   *
   * 404s (never leaks) on: unknown finding, a cross-workspace finding, or an
   * agent-less owning review (AC-4 — there is no agent config to score
   * against). 400s when the finding is still pending (AC-3 — reject, don't
   * silently accept a not-yet-decided finding).
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.reviewRepo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    if (!review.agentId) {
      throw new NotFoundError('Finding belongs to an agent-less review — cannot create an eval case');
    }

    const disposition = resolveDisposition(finding.acceptedAt, finding.dismissedAt);
    if (disposition === 'pending') {
      throw new AppError(
        'finding_pending',
        'Finding must be accepted or dismissed before it can become an eval case',
        400,
      );
    }

    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // Live diff, sliced to JUST this finding's file (AC-5). This is the ONE
    // and ONLY time the PR's diff is read for this case — re-syncing the
    // source PR afterward never touches an already-created case's stored
    // input (AC-5/AC-6 — frozen point-in-time snapshot).
    const diff = await loadDiff(this.container, this.reviewRepo, workspaceId, pull, repoRow);
    const sliced = sliceDiffForFile(diff, finding.file);

    const findingDto = findingRowToDto(finding);
    // `buildExpectationFromFinding` always returns exactly one item (one
    // finding in, one ExpectationItem out) — see its own implementation.
    const newItem = buildExpectationFromFinding(findingDto, disposition)[0]!;

    // Merge into an existing case for this agent that already froze the
    // EXACT SAME file diff (byte-identical `input_diff`), rather than always
    // creating a new single-expectation case — a file with several distinct
    // real findings (e.g. SQL injection + a hardcoded secret + mass
    // assignment, all in one controller) would otherwise spawn one case per
    // finding, and each case would then score the OTHER real findings as
    // unbacked "extra" noise, tanking precision for reasons unrelated to the
    // agent's actual quality. Byte-identical diff (not just same `file` path)
    // is the merge key so a stale expectation's line numbers are never
    // merged against a diff version they weren't authored against — if the
    // file changed since an earlier case was frozen, this falls through to
    // creating a new, separate case instead (never silently drops data).
    const mergeTarget = (
      await this.evalRepo.listByOwner(workspaceId, 'agent', review.agentId)
    ).find((c) => c.inputDiff === sliced.raw);

    if (mergeTarget) {
      const existing = Array.isArray(mergeTarget.expectedOutput)
        ? (mergeTarget.expectedOutput as ExpectationItem[])
        : [];
      const alreadyPresent = existing.some(
        (item) =>
          item.file === newItem.file &&
          item.type === newItem.type &&
          item.start_line === newItem.start_line &&
          (item.end_line ?? item.start_line) === (newItem.end_line ?? newItem.start_line),
      );
      const merged = alreadyPresent ? existing : [...existing, newItem];
      const updated = await this.evalRepo.updateCase(workspaceId, mergeTarget.id, {
        expectedOutput: merged,
      });
      return caseRowToDto(updated ?? mergeTarget);
    }

    const inputMeta = {
      pr_title: pull.title,
      pr_number: pull.number,
      repo: `${repoRow.owner}/${repoRow.name}`,
      base: pull.base,
      head_sha: pull.headSha,
      snapshotted_at: new Date().toISOString(),
    };

    const name = `${findingDto.title} — ${finding.file}`.slice(0, 200);

    const row = await this.evalRepo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name,
      inputDiff: sliced.raw,
      inputFiles: sliced.files,
      inputMeta,
      expectedOutput: [newItem],
      notes: null,
    });

    return caseRowToDto(row);
  }

  // =========================================================================
  // Plain eval-case CRUD (hand-authored cases) — thin pass-throughs over
  // `EvalRepository`, kept here (not called directly from `routes.ts`) so
  // routes never touch Drizzle/`EvalRepository` directly, per this module's
  // onion-architecture layering (mirrors `SkillsService`'s CRUD wrappers).
  // =========================================================================

  /** List every hand-authored + finding-derived case owned by one agent. */
  async listCasesForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalCaseWithLatestRun[]> {
    const rows = await this.evalRepo.listByOwner(workspaceId, 'agent', agentId);
    return Promise.all(
      rows.map(async (row) => {
        const latestRun = await this.evalRepo.latestRunForCase(row.id);
        return {
          ...caseRowToDto(row),
          latest_run: latestRun ? runRowToRecord(latestRun, row.name) : null,
        };
      }),
    );
  }

  /** One case by id, workspace-scoped. Undefined → route 404 (AC-39). */
  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.evalRepo.getCase(workspaceId, id);
    return row ? caseRowToDto(row) : undefined;
  }

  /** Create a hand-authored case scoped to one agent (`owner_kind`/`owner_id`
   *  are always server-set here, never client-supplied). */
  async createAgentCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseInputFields,
  ): Promise<EvalCase> {
    const row = await this.evalRepo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? '',
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row);
  }

  /** Persist-only field update (name/input_diff/input_files/input_meta/
   *  expected_output/notes). No "run on save" side effect — the client makes
   *  a separate, explicit `useRunEvalBatch` call after a successful save.
   *  Undefined → route 404 (AC-39). */
  async updateCase(
    workspaceId: string,
    id: string,
    patch: Partial<EvalCaseInputFields>,
  ): Promise<EvalCase | undefined> {
    const row = await this.evalRepo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? caseRowToDto(row) : undefined;
  }

  /** Delete a case (and its runs, cascade). False → route 404 (AC-39). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.evalRepo.deleteCase(workspaceId, id);
  }

  // =========================================================================
  // Run a batch (AC-11/AC-12/AC-13/AC-20/AC-21)
  // =========================================================================

  /**
   * Execute the agent's CURRENT runnable config against every targeted case's
   * STORED inputs — never a live fetch (AC-11/AC-12). Config assembly
   * duplicates `run-executor.ts`'s (agent row fields + a separate
   * `agentsRepo.linkedSkills` call) deliberately — no shared "resolve agent's
   * full runnable config" helper exists yet to extract instead.
   *
   * A per-case throw degrades that ONE case to a zeroed/failed `EvalRun` row
   * (mirrors the codebase's "degrade per unit, don't 5xx the whole request"
   * convention) rather than aborting the whole batch.
   */
  async runBatch(
    workspaceId: string,
    agentId: string,
    caseIds?: string[],
  ): Promise<EvalRunBatchResponse> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const allCases = await this.evalRepo.listByOwner(workspaceId, 'agent', agentId);
    const targetCases =
      caseIds && caseIds.length > 0
        ? allCases.filter((c) => caseIds.includes(c.id)) // cross-agent/invalid ids silently dropped
        : allCases;

    if (targetCases.length === 0) {
      // AC-11 edge case: empty target set → empty aggregate, not an error.
      const dashboard = await this.getAgentDashboard(workspaceId, agentId);
      return { run_batch_id: randomUUID(), results: [], dashboard };
    }

    const runBatchId = randomUUID();
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);
    const llm = await this.container.llm(agent.provider as Provider);

    const queue = new PQueue({ concurrency: MAX_CONCURRENT_CASE_REVIEWS });
    const results: EvalRunResult[] = [];

    await Promise.all(
      targetCases.map((evalCase) =>
        queue.add(async () => {
          const evalRun = await this.executeOneCase(agent, llm, skillBodies, evalCase);
          const row = await this.evalRepo.insertRun(evalCase.id, runBatchId, agent.version, evalRun);
          results.push({ run_id: row.id, case_id: evalCase.id, result: evalRun });
        }),
      ),
    );

    const dashboard = await this.getAgentDashboard(workspaceId, agentId);
    return { run_batch_id: runBatchId, results, dashboard };
  }

  /**
   * Run ONE case through the SAME `reviewer-core` review path a live PR uses,
   * feeding the case's own stored `input_diff`/`input_files` directly (never
   * re-fetching), then score 100% in code (`scoring.ts` — zero LLM calls
   * beyond the one review-generation call above, AC-20/AC-21).
   *
   * Any throw (LLM failure, malformed stored diff, etc.) degrades to a
   * zeroed/failed `EvalRun` — the caller never sees this reject.
   */
  private async executeOneCase(
    agent: AgentRow,
    llm: LLMProvider,
    skillBodies: string[],
    evalCase: EvalCaseRow,
  ): Promise<EvalRun> {
    const start = Date.now();
    try {
      // Re-derive `files` (path/additions/deletions/hunks) from the stored raw
      // diff text via the SAME parser the citation-grounding gate's callers use
      // — `evalCase.inputFiles` is a separate, unrelated "list of touched
      // paths" snapshot (display-only, e.g. for the case editor's Files tab),
      // not the shaped `UnifiedDiff['files']` grounding needs. Casting it
      // directly (a bug caught in review) made every produced finding fail to
      // ground against a real hunk, so every run silently scored 0 recall.
      const diff: UnifiedDiff = parseUnifiedDiff(evalCase.inputDiff ?? '');

      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        strategy: agent.strategy,
        ...(skillBodies.length ? { skills: skillBodies } : {}),
        // Never interpolate `evalCase.name` here — for a case created from a
        // finding it can carry PR-author-influenced text (an LLM-generated
        // finding title), and `task` is NOT passed through `wrapUntrusted`
        // (unlike `diff`, below prompt.ts's trust boundary). A fixed,
        // content-free string serves the same purpose with no injection
        // channel (security review finding, fixed here).
        task: 'Eval case replay — review the diff below.',
        sessionId: `eval:${agent.id}:${evalCase.id}`,
      });

      const expected = parseExpectedOutput(evalCase.expectedOutput);
      const groundedFindings: Finding[] = outcome.review.findings;
      const matches = matchExpectations(expected, groundedFindings);
      const extras = classifyExtraFindings(groundedFindings, matches);

      const recall = computeRecall(expected, matches);
      const precision = computePrecision(groundedFindings, matches);
      const citationAccuracy = computeCitationAccuracy(
        groundedFindings.length,
        outcome.dropped.length,
      );

      // One trace per expectation item (matched-as-expected = pass) PLUS one
      // per unbacked "extra" grounded finding (always a fail — it debits
      // precision). This keeps `traces_passed === traces_total` exactly
      // equivalent to `recall === 1 && precision === 1` (AC-19), which
      // `helpers.ts`'s `buildTrendPoint` and `repository.ts`'s `insertRun`
      // both rely on to derive pass/fail from trace counts alone.
      const expectationTraces: EvalPerTrace[] = matches.map((m) => ({
        name: `${m.item.type} ${m.item.file}:${m.item.start_line}`,
        pass: m.item.type === 'must_find' ? m.matched : !m.matched,
        expected: m.item,
        actual: m.finding ?? null,
      }));
      const extraTraces: EvalPerTrace[] = extras.map((e) => ({
        name: `unexpected (${e.tag}) ${e.finding.file}:${e.finding.start_line}`,
        pass: false,
        expected: null,
        actual: e.finding,
      }));
      // Synthetic, ALWAYS-PASSING marker trace carrying the one number the
      // client's "got M" status strip actually needs: how many GROUNDED
      // findings this run's review call produced overall
      // (`groundedFindings.length` — the same value `computeRecall`/
      // `computePrecision` operate over above), NOT a count reconstructable
      // from the other trace entries (`expectationTraces`/`extraTraces` have
      // one row per EXPECTATION/extra item — including unmatched `must_find`
      // items backed by no produced finding at all — so their entry count is
      // not the produced-findings count in general, and no single entry's own
      // `actual` is ever an array of every produced finding — each is either
      // one `Finding` or `null`).
      //
      // PREPENDED (not appended) so `per_trace[0]` is always this marker for
      // any non-error run — every current client read of "how many findings
      // did this run produce" (`EvalCaseEditor/helpers.ts`'s
      // `stripDataFromResult`, `EvalsTab/helpers.ts`'s `toRunRecord`, and
      // `EvalsTab.tsx`'s own inline read) already indexes `per_trace[0]`, so
      // this keeps all of them correct without requiring each call site to
      // search `per_trace` by name. `EvalRun`/`EvalPerTrace`'s vendored Zod
      // contract (`z.unknown()` for `expected`/`actual`) is unchanged — this
      // is a value-shape convention, not a schema change.
      //
      // Adds exactly 1 to BOTH `traces_passed` and `traces_total` (it always
      // passes), so it never changes whether `traces_passed === traces_total`
      // — the invariant `repository.ts`'s `insertRun` and `helpers.ts`'s
      // `buildTrendPoint` rely on for pass/fail stays intact.
      const producedCountTrace: EvalPerTrace = {
        name: '__produced_count__',
        pass: true,
        expected: null,
        actual: { produced: groundedFindings.length },
      };
      const perTrace = [producedCountTrace, ...expectationTraces, ...extraTraces];
      const tracesPassed = perTrace.filter((t) => t.pass).length;

      return {
        recall,
        precision,
        citation_accuracy: citationAccuracy,
        traces_passed: tracesPassed,
        traces_total: perTrace.length,
        duration_ms: Date.now() - start,
        cost_usd: outcome.costUsd,
        per_trace: perTrace,
      };
    } catch (err) {
      // Degrade THIS case only — never abort the whole batch.
      return {
        recall: 0,
        precision: 0,
        citation_accuracy: 0,
        traces_passed: 0,
        traces_total: 0,
        duration_ms: Date.now() - start,
        cost_usd: null,
        per_trace: [
          {
            name: 'error',
            pass: false,
            expected: null,
            actual: (err as Error).message ?? 'Unknown error',
          },
        ],
      };
    }
  }

  // =========================================================================
  // Dashboards
  // =========================================================================

  /** One agent's eval dashboard: case count, current/delta metrics, trend, alert. */
  async getAgentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const cases = await this.evalRepo.listByOwner(workspaceId, 'agent', agentId);
    const batches = await this.evalRepo.recentBatchesForOwner(
      workspaceId,
      'agent',
      agentId,
      DEFAULT_TREND_LIMIT,
    );
    // `recentBatchesForOwner` returns newest-first.
    const newestFirst = batches.map(toTrendPoint);
    const oldestFirst = [...newestFirst].reverse();

    const latest = newestFirst[0];
    const previous = newestFirst[1];

    const latestBatch = batches[0];
    const current = latest
      ? {
          recall: latest.recall,
          precision: latest.precision,
          citation_accuracy: latest.citation_accuracy,
          traces_passed: Math.round(latestBatch!.passRate * latestBatch!.caseCount),
          traces_total: latestBatch!.caseCount,
          cost_usd: latest.cost_usd,
        }
      : {
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          traces_passed: 0,
          traces_total: 0,
          cost_usd: null,
        };

    const delta = previous
      ? {
          recall: current.recall - previous.recall,
          precision: current.precision - previous.precision,
          citation_accuracy: current.citation_accuracy - previous.citation_accuracy,
        }
      : { recall: 0, precision: 0, citation_accuracy: 0 };

    const notable = latest ? selectNotableMetric(latest, previous) : null;

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      current,
      delta,
      trend: oldestFirst,
      recent_runs: newestFirst,
      alert: notable?.message ?? null,
    };
  }

  /**
   * Workspace-wide index: one `EvalAgentSummary` per ENABLED agent (including
   * ones with zero run batches — an empty dashboard is a neutral empty state,
   * not an absent agent, AC-31), plus a workspace-wide cross-agent recent-runs
   * table.
   */
  async getWorkspaceDashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const enabledAgents = await this.container.agentsRepo.listEnabled(workspaceId);

    const agents: EvalAgentSummary[] = [];
    for (const agent of enabledAgents) {
      const dashboard = await this.getAgentDashboard(workspaceId, agent.id);
      agents.push({ agent_id: agent.id, agent_name: agent.name, dashboard });
    }

    const workspaceBatches = await this.evalRepo.recentBatchesWorkspace(
      workspaceId,
      DEFAULT_WORKSPACE_TREND_LIMIT,
    );
    const allAgents = await this.container.agentsRepo.list(workspaceId);
    const nameById = new Map(allAgents.map((a) => [a.id, a.name]));

    const recentRuns: EvalGlobalRunRow[] = workspaceBatches
      .filter((b): b is EvalRunBatchWithOwnerRow => b.ownerKind === 'agent')
      .map((b) => ({
        ...toTrendPoint(b),
        agent_id: b.ownerId,
        agent_name: nameById.get(b.ownerId) ?? 'Unknown agent',
      }));

    return { agents, recent_runs: recentRuns };
  }

  /**
   * "Run all agents" (AC-32) — a thin, SEQUENTIAL loop over `runBatch`, never
   * fanned out further (keeps `MAX_CONCURRENT_CASE_REVIEWS` as the only
   * concurrency cap in play at once, not compounded across agents). Skips
   * (never errors on) an enabled agent with zero eval cases.
   */
  async runAllAgents(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const enabledAgents = await this.container.agentsRepo.listEnabled(workspaceId);
    for (const agent of enabledAgents) {
      const cases = await this.evalRepo.listByOwner(workspaceId, 'agent', agent.id);
      if (cases.length === 0) continue;
      await this.runBatch(workspaceId, agent.id);
    }
    return this.getWorkspaceDashboard(workspaceId);
  }
}

// ===========================================================================
// Pure mapping helpers (private to this module — not exported)
// ===========================================================================

function caseRowToDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

/** Adapt a persisted `eval_runs` row into the vendored `EvalRunRecord` shape —
 *  used by `listCasesForAgent` so a case list survives a page reload (AC:
 *  "never run" should mean genuinely never run, not "the client forgot"). */
function runRowToRecord(row: EvalRunRow, caseName: string): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/** Adapt an already-aggregated `EvalRunBatchRow` into the vendored `EvalTrendPoint`
 *  shape — no re-aggregation here, `repository.ts` already computed the means. */
function toTrendPoint(batch: EvalRunBatchRow): EvalTrendPoint {
  return {
    run_id: batch.runBatchId,
    agent_version: batch.agentVersion,
    ran_at: batch.ranAt.toISOString(),
    recall: batch.recall,
    precision: batch.precision,
    citation_accuracy: batch.citationAccuracy,
    pass_rate: batch.passRate,
    cost_usd: batch.costUsd,
  };
}

/**
 * Defensively parse `expected_output` (stored as `z.unknown()` JSON, never
 * itself Zod-validated server-side beyond "is a JSON array") into
 * `ExpectationItem[]`. Any non-array, or any array entry missing the minimum
 * required shape, is dropped rather than thrown — a malformed case must
 * degrade its own score, never crash the batch.
 */
function parseExpectedOutput(raw: unknown): ExpectationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ExpectationItem => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Record<string, unknown>;
    return (
      (candidate.type === 'must_find' || candidate.type === 'must_not_flag') &&
      typeof candidate.file === 'string' &&
      typeof candidate.start_line === 'number'
    );
  });
}
