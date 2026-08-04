/**
 * Export to CI — end-to-end AC proofs (Docker-gated: real container + real
 * Postgres via Testcontainers, following `eval/eval.it.test.ts`).
 *
 * **A mocked GitHub client proves the ci module CALLS the adapter correctly; it
 * cannot prove the adapter works.** AC-27, AC-29, AC-30 and AC-31 are verified
 * against a REAL throwaway repository in the manual pass — the three write
 * methods this feature rides on (`commitFiles` / `findOpenPr` /
 * `openPullRequest`) had zero production callers before it. Everything below is
 * the secondary regression guard, exactly as the spec's *Install* preamble says.
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import YAML from 'yaml';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import {
  AgentManifest,
  CiExport,
  CiIngestResult,
  CiRunsResponse,
  type ArtifactMeta,
  type CiInstallation,
  type LLMProvider,
  type WorkflowRunMeta,
} from '@devdigest/shared';
import { ARTIFACT_FILE, ARTIFACT_MAX_BYTES, REFRESH_MAX_RUNS } from './constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available — skipping integration tests.');
}

// ===========================================================================
// Doubles & fixtures
// ===========================================================================

type LlmId = 'openai' | 'anthropic' | 'openrouter';

/** Every method throws — the concrete proof that this feature makes ZERO LLM calls (R11). */
function throwingLlm(id: LlmId): LLMProvider {
  const boom = (): never => {
    throw new Error(`Export to CI must never call the ${id} LLM provider`);
  };
  return {
    id,
    listModels: async () => boom(),
    complete: async () => boom(),
    completeStructured: async () => boom(),
    embed: async () => boom(),
  };
}

const THROWING_LLM = {
  openai: throwingLlm('openai'),
  anthropic: throwingLlm('anthropic'),
  openrouter: throwingLlm('openrouter'),
};

/** The three files an ncc build emits — never the real 1.6 MB bundle. */
const RUNNER_FIXTURE: Record<string, string> = {
  'index.js': 'export const entry = 1;\n',
  '300.index.js': 'export const chunk = 2;\n',
  'package.json': '{"type":"module"}',
};

const tempDirs: string[] = [];

async function makeRunnerDir(
  files: Record<string, string> = RUNNER_FIXTURE,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ci-it-runner-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body, 'utf8');
  return dir;
}

function artifactZip(payload: unknown): Uint8Array {
  return zipSync({ [ARTIFACT_FILE]: strToU8(JSON.stringify(payload)) });
}

function workflowRun(over: Partial<WorkflowRunMeta> & { id: string }): WorkflowRunMeta {
  return {
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/acme/demo/actions/runs/${over.id}`,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:05:00Z',
    run_started_at: '2026-08-01T10:00:00Z',
    display_title: 'Fix the thing',
    pull_number: null,
    ...over,
  };
}

const artifactMeta = (id: string): ArtifactMeta[] => [
  { id, name: 'devdigest-result', size_in_bytes: 200, expired: false },
];

const goodResult = (over: Record<string, unknown> = {}) => ({
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.012,
  duration_ms: 45_000,
  agent: 'CI Fixture Agent',
  ...over,
});

// ===========================================================================

d('Export to CI (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let runnerDir: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    runnerDir = await makeRunnerDir();
  }, 180_000);

  afterAll(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
    await pg?.stop();
  });

  let seq = 0;
  const uniq = (label: string) => `${label}-${seq++}-${Date.now()}`;

  function config(dir?: string) {
    return loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DEVDIGEST_RUNNER_DIST_DIR: dir ?? runnerDir,
    } as NodeJS.ProcessEnv);
  }

  interface AppOpts {
    runnerDir?: string;
    github?: MockGitHubClient | null;
    secrets?: MockSecretsProvider;
  }

  async function makeApp(opts: AppOpts = {}) {
    const github = opts.github === null ? undefined : (opts.github ?? new MockGitHubClient());
    const app = await buildApp({
      config: config(opts.runnerDir),
      db: pg.handle.db,
      overrides: {
        ...(github ? { github } : {}),
        ...(opts.secrets ? { secrets: opts.secrets } : {}),
        llm: THROWING_LLM,
      },
    });
    return { app, github: github as MockGitHubClient };
  }

  // ---- fixture builders ---------------------------------------------------

  async function makeAgent(
    over: Partial<typeof t.agents.$inferInsert> = {},
    ws = workspaceId,
  ) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: over.name ?? uniq('CI Agent'),
        provider: 'openrouter',
        model: 'openrouter/deepseek-v4-flash',
        systemPrompt: 'You review pull requests.',
        strategy: 'single-pass',
        ciFailOn: 'critical',
        ...over,
      })
      .returning();
    return row!;
  }

  async function makeRepo(ws = workspaceId) {
    const name = uniq('demo');
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return row!;
  }

  async function linkSkill(agentId: string, name: string, enabled = true, order = 0) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'ci it-test fixture',
        type: 'custom',
        source: 'manual',
        body: `# ${name}\nrules\n`,
        enabled,
      })
      .returning();
    await pg.handle.db
      .insert(t.agentSkills)
      .values({ agentId, skillId: skill!.id, order });
    return skill!;
  }

  const exportBody = (repo: string, over: Record<string, unknown> = {}) => ({
    repo,
    target: 'gha',
    action: 'files',
    post_as: 'github_review',
    triggers: ['opened', 'synchronize'],
    base: 'main',
    ...over,
  });

  // =========================================================================
  // Generation and blocks
  // =========================================================================

  describe('generation', () => {
    it('produces the exact AC-7 path list for an agent with two enabled skills', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      await linkSkill(agent.id, 'Secret Leakage Gate', true, 0);
      await linkSkill(agent.id, 'Phantom API Detector', true, 1);
      const { app, github } = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName),
      });
      expect(res.statusCode).toBe(200);

      const body = CiExport.parse(res.json());
      expect(body.files.map((f) => f.path)).toEqual([
        `.devdigest/agents/${slugOf(agent.name)}.yaml`,
        '.devdigest/skills/secret-leakage-gate.md',
        '.devdigest/skills/phantom-api-detector.md',
        '.devdigest/memory.jsonl',
        '.devdigest/runner/300.index.js',
        '.devdigest/runner/index.js',
        '.devdigest/runner/package.json',
        '.github/workflows/devdigest-review.yml',
      ]);
      expect(body.file_count).toBe(8);
      expect(body.repo).toBe(repo.fullName);

      // AC-71 — the browser never receives bundle text.
      for (const f of body.files.filter((x) => x.path.startsWith('.devdigest/runner/'))) {
        expect(f.contents).toBe('');
        expect(f.placeholder).toBeTruthy();
      }
      // Preview writes nothing and contacts nothing.
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
      expect(await installationsOf(agent.id)).toHaveLength(0);

      // AC-8/AC-19 — the manifest validates under the SHARED schema, no post_as.
      const manifest = AgentManifest.parse(YAML.parse(body.files[0]!.contents));
      expect(manifest.skills).toEqual(['secret-leakage-gate', 'phantom-api-detector']);
      expect(body.files[0]!.contents).not.toContain('post_as');

      await app.close();
    });

    it('rejects with the runner build command and writes nothing when the bundle is missing (AC-15)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const { app, github } = await makeApp({ runnerDir: join(tmpdir(), 'definitely-absent-xyz') });

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toContain('cd agent-runner && pnpm build');
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
      expect(await installationsOf(agent.id)).toHaveLength(0);
      await app.close();
    });

    it('fails the WHOLE export — zero commits — when one runner file is unreadable (AC-15a)', async () => {
      const canDenyRead = typeof process.getuid === 'function' && process.getuid!() !== 0;
      const agent = await makeAgent();
      const repo = await makeRepo();
      const dir = await makeRunnerDir();
      if (!canDenyRead) return;
      const { chmod } = await import('node:fs/promises');
      await chmod(join(dir, '300.index.js'), 0o000);

      const { app, github } = await makeApp({ runnerDir: dir });
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });

      expect(res.statusCode).toBe(422);
      // Never a commit carrying the REMAINING files.
      expect(github.committed).toHaveLength(0);
      expect(await installationsOf(agent.id)).toHaveLength(0);
      await chmod(join(dir, '300.index.js'), 0o644);
      await app.close();
    });

    it('refuses a non-openrouter agent at generation, naming the provider (AC-67)', async () => {
      const agent = await makeAgent({ provider: 'anthropic', model: 'claude-3' });
      const repo = await makeRepo();
      const { app, github } = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toContain('anthropic');
      expect(res.json().error.message).toContain('openrouter');
      expect(github.committed).toHaveLength(0);
      await app.close();
    });

    it('refuses a repository outside the caller’s workspace (AC-66)', async () => {
      const agent = await makeAgent();
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: uniq('other-ws') })
        .returning();
      const foreign = await makeRepo(otherWs!.id);
      const { app, github } = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(foreign.fullName, { action: 'open_pr' }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toContain('not a repository in this workspace');
      expect(github.committed).toHaveLength(0);
      await app.close();
    });

    it('refuses a repository already claimed by a different agent, naming it (AC-68)', async () => {
      const first = await makeAgent({ name: uniq('First Agent') });
      const second = await makeAgent({ name: uniq('Second Agent') });
      const repo = await makeRepo();
      const { app, github } = await makeApp();

      const ok = await app.inject({
        method: 'POST',
        url: `/agents/${first.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      expect(ok.statusCode).toBe(200);
      const commitsAfterFirst = github.committed.length;

      const blocked = await app.inject({
        method: 'POST',
        url: `/agents/${second.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json().error.message).toContain(first.name);
      expect(github.committed).toHaveLength(commitsAfterFirst);
      expect(await installationsOf(second.id)).toHaveLength(0);
      await app.close();
    });
  });

  // =========================================================================
  // Install
  // =========================================================================

  describe('install', () => {
    it('commits once onto devdigest/ci and never the default branch (AC-27, AC-28)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const { app, github } = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      expect(res.statusCode).toBe(200);

      expect(github.committed).toHaveLength(1);
      expect(github.committed[0]!.branch).toBe('devdigest/ci');
      expect(github.committed[0]!.base).toBe('main');
      expect(github.committed.every((c) => c.branch !== 'main')).toBe(true);
      // One atomic commit carrying EVERY generated file (this agent has no
      // skills: manifest + memory + three runner files + workflow).
      expect(github.committed[0]!.files.map((f) => f.path)).toEqual([
        `.devdigest/agents/${slugOf(agent.name)}.yaml`,
        '.devdigest/memory.jsonl',
        '.devdigest/runner/300.index.js',
        '.devdigest/runner/index.js',
        '.devdigest/runner/package.json',
        '.github/workflows/devdigest-review.yml',
      ]);
      // The commit carries the REAL runner bytes, not the preview placeholder.
      const runner = github.committed[0]!.files.find(
        (f) => f.path === '.devdigest/runner/index.js',
      )!;
      expect(runner.contents).toBe(RUNNER_FIXTURE['index.js']);
      await app.close();
    });

    it('opens exactly one PR against the configured base and persists its URL (AC-31)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const { app, github } = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      const body = CiExport.parse(res.json());

      expect(github.openedPrs).toHaveLength(1);
      expect(github.openedPrs[0]!.base).toBe('main');
      expect(github.openedPrs[0]!.head).toBe('devdigest/ci');
      expect(body.pr_url).toBe(github.openedPrs[0] && 'https://github.com/mock/mock/pull/1');
      const [row] = await installationsOf(agent.id);
      expect(row!.prUrl).toBe(body.pr_url);
      await app.close();
    });

    it('reuses an already-open PR for the branch and opens no second one (AC-30)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const github = new MockGitHubClient({
        openPrsByBranch: { 'devdigest/ci': 'https://github.com/acme/demo/pull/9' },
      });
      const { app } = await makeApp({ github });

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });

      expect(CiExport.parse(res.json()).pr_url).toBe('https://github.com/acme/demo/pull/9');
      expect(github.openedPrs).toHaveLength(0);
      await app.close();
    });

    it('leaves ONE installation row whose workflow version grew by exactly one (AC-1, AC-32)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const { app } = await makeApp();
      const payload = exportBody(repo.fullName, { action: 'open_pr' });

      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload });
      const afterFirst = await installationsOf(agent.id);
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0]!.workflowVersion).toBe(1);

      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload });
      const afterSecond = await installationsOf(agent.id);
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0]!.id).toBe(afterFirst[0]!.id);
      expect(afterSecond[0]!.workflowVersion).toBe(2);
      await app.close();
    });

    it('keeps the ORIGINAL manifest path after a rename, creating no second manifest (AC-3)', async () => {
      const agent = await makeAgent({ name: uniq('Original Name') });
      const repo = await makeRepo();
      const { app, github } = await makeApp();
      const payload = exportBody(repo.fullName, { action: 'open_pr' });

      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload });
      const pinned = (await installationsOf(agent.id))[0]!.manifestPath;

      await pg.handle.db
        .update(t.agents)
        .set({ name: 'Renamed Entirely' })
        .where(eq(t.agents.id, agent.id));

      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload });

      const secondCommit = github.committed.at(-1)!;
      const manifests = secondCommit.files.filter((f) =>
        f.path.startsWith('.devdigest/agents/'),
      );
      expect(manifests).toHaveLength(1);
      expect(manifests[0]!.path).toBe(pinned);
      expect(AgentManifest.parse(YAML.parse(manifests[0]!.contents)).name).toBe(
        'Renamed Entirely',
      );
      expect((await installationsOf(agent.id))[0]!.manifestPath).toBe(pinned);
      await app.close();
    });

    it('records no installation when the commit fails (AC-33)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const github = new MockGitHubClient();
      github.commitFiles = async () => {
        throw new Error('mock: commit rejected');
      };
      const { app } = await makeApp({ github });

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.json().error.message).toContain('commit rejected');
      expect(await installationsOf(agent.id)).toHaveLength(0);
      await app.close();
    });

    it('leaves a pre-existing installation unchanged when the PR call fails (AC-33)', async () => {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const { app } = await makeApp();
      const payload = exportBody(repo.fullName, { action: 'open_pr' });
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload });
      const before = (await installationsOf(agent.id))[0]!;
      await app.close();

      const github = new MockGitHubClient();
      github.findOpenPr = async () => null;
      github.openPullRequest = async () => {
        throw new Error('mock: PR creation rejected');
      };
      const second = await makeApp({ github });
      const res = await second.app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const after = (await installationsOf(agent.id))[0]!;
      expect(after.workflowVersion).toBe(before.workflowVersion);
      expect(after.prUrl).toBe(before.prUrl);
      await second.app.close();
    });
  });

  // =========================================================================
  // Zip fallback
  // =========================================================================

  it('zips exactly the AC-7 file set with ZERO GitHub calls (AC-78)', async () => {
    const agent = await makeAgent();
    const repo = await makeRepo();
    await linkSkill(agent.id, 'Only Skill');
    const { app, github } = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci/zip`,
      payload: exportBody(repo.fullName),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(entries).sort()).toEqual([
      '.devdigest/agents/' + slugOf(agent.name) + '.yaml',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/300.index.js',
      '.devdigest/runner/index.js',
      '.devdigest/runner/package.json',
      '.devdigest/skills/only-skill.md',
      '.github/workflows/devdigest-review.yml',
    ]);
    // The REAL runner bytes travel in the archive, not the preview placeholder.
    expect(strFromU8(entries['.devdigest/runner/index.js']!)).toBe(RUNNER_FIXTURE['index.js']);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(github.actionsCalls).toHaveLength(0);
    await app.close();
  });

  // =========================================================================
  // Installations read (agent CI tab)
  // =========================================================================

  it('reports pending before any ingest and flags policy drift after a change (AC-58, AC-60)', async () => {
    const agent = await makeAgent({ ciFailOn: 'critical' });
    const repo = await makeRepo();
    const { app } = await makeApp();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: exportBody(repo.fullName, { action: 'open_pr' }),
    });

    const before = await app.inject({ url: `/agents/${agent.id}/ci-installations` });
    const rows = before.json() as CiInstallation[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBeNull(); // pending — never success or failure
    expect(rows[0]!.workflow_version).toBe(1);
    expect(rows[0]!.policy_drift).toBe(false);
    expect(rows[0]!.exported_ci_fail_on).toBe('critical');

    await pg.handle.db
      .update(t.agents)
      .set({ ciFailOn: 'never' })
      .where(eq(t.agents.id, agent.id));

    const after = await app.inject({ url: `/agents/${agent.id}/ci-installations` });
    expect((after.json() as CiInstallation[])[0]!.policy_drift).toBe(true);
    await app.close();
  });

  // =========================================================================
  // Ingest
  // =========================================================================

  describe('ingest', () => {
    // Refresh walks EVERY installation in the workspace, and each test's mock
    // serves the same fixture runs to all of them — so the batch is isolated
    // here rather than accumulating across tests.
    beforeEach(async () => {
      await pg.handle.db.delete(t.ciRuns);
      await pg.handle.db.delete(t.ciInstallations);
      await pg.handle.db.delete(t.agentRuns).where(eq(t.agentRuns.source, 'ci'));
    });

    /** Install an agent into a fresh repo and return both ids. */
    async function installed(app: Awaited<ReturnType<typeof makeApp>>['app']) {
      const agent = await makeAgent();
      const repo = await makeRepo();
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });
      expect(res.statusCode).toBe(200);
      return { agent, repo };
    }

    it('lists runs, downloads the artifact and writes both rows (AC-34, AC-36)', async () => {
      const runId = uniq('run').replace(/\D/g, '') || '1001';
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: runId })],
        artifacts: { [runId]: artifactMeta('art-1') },
        artifactBytes: { 'art-1': artifactZip(goodResult()) },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const res = await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
      expect(res.statusCode).toBe(200);
      const result = CiIngestResult.parse(res.json());
      expect(result.ingested).toBeGreaterThanOrEqual(1);
      expect(github.actionsCalls).toContain(
        `listWorkflowRuns:devdigest-review.yml:${REFRESH_MAX_RUNS}`,
      );
      expect(github.actionsCalls).toContain('downloadArtifact:art-1');

      const ciRuns = await runsFor(agent.id);
      expect(ciRuns).toHaveLength(1);
      expect(ciRuns[0]!.githubRunId).toBe(runId);
      expect(ciRuns[0]!.status).toBe('succeeded');
      expect(ciRuns[0]!.critical).toBe(1);
      expect(ciRuns[0]!.prTitle).toBe('Fix the thing');
      expect(ciRuns[0]!.agentRunId).not.toBeNull();

      const [agentRun] = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, ciRuns[0]!.agentRunId!));
      expect(agentRun!.source).toBe('ci');
      expect(agentRun!.findingsCount).toBe(2);
      expect(agentRun!.costUsd).toBeCloseTo(0.012, 5);
      expect(agentRun!.prId).toBeNull(); // AC-38 — PR not imported here
      await app.close();
    });

    it('is idempotent across three consecutive refreshes (AC-5)', async () => {
      const runId = '2002';
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: runId })],
        artifacts: { [runId]: artifactMeta('art-2') },
        artifactBytes: { 'art-2': artifactZip(goodResult()) },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      for (let i = 0; i < 3; i++) {
        await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
      }

      expect(await runsFor(agent.id)).toHaveLength(1);
      const agentRuns = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
      expect(agentRuns).toHaveLength(1);
      await app.close();
    });

    it('links the agent_runs row to a pull request the workspace already knows (AC-38)', async () => {
      const runId = '3003';
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: runId })],
        artifacts: { [runId]: artifactMeta('art-3') },
        artifactBytes: { 'art-3': artifactZip(goodResult({ pr_number: 42 })) },
      });
      const { app } = await makeApp({ github });
      const agent = await makeAgent();
      const repo = await makeRepo();
      await pg.handle.db.insert(t.pullRequests).values({
        workspaceId,
        repoId: repo.id,
        number: 42,
        title: 'Imported PR',
        author: 'igorn',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha42',
      });
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: exportBody(repo.fullName, { action: 'open_pr' }),
      });

      await app.inject({ method: 'POST', url: '/ci-runs/refresh' });

      const ciRuns = await runsFor(agent.id);
      expect(ciRuns[0]!.prNumber).toBe(42);
      const [agentRun] = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, ciRuns[0]!.agentRunId!));
      expect(agentRun!.prId).not.toBeNull();
      await app.close();
    });

    it('rejects a schema-invalid artifact and produces NO row (AC-39)', async () => {
      const runId = '4004';
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: runId })],
        artifacts: { [runId]: artifactMeta('art-4') },
        // `findings_count` missing / wrong type and no `agent`.
        artifactBytes: { 'art-4': artifactZip({ findings_count: 'lots' }) },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );

      expect(await runsFor(agent.id)).toHaveLength(0);
      expect(result.ingested).toBe(0);
      expect(result.failures.some((f) => f.github_run_id === runId)).toBe(true);
      await app.close();
    });

    it('ingests a batch of one artifact-less run plus two good runs (AC-40)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [
          workflowRun({ id: '5003', run_started_at: '2026-08-01T12:00:00Z' }),
          workflowRun({ id: '5002', run_started_at: '2026-08-01T11:00:00Z', conclusion: 'failure' }),
          workflowRun({ id: '5001', run_started_at: '2026-08-01T10:00:00Z' }),
        ],
        artifacts: { '5003': artifactMeta('a-5003'), '5001': artifactMeta('a-5001') },
        artifactBytes: {
          'a-5003': artifactZip(goodResult()),
          'a-5001': artifactZip(goodResult({ findings_count: 0, critical: 0, warning: 0 })),
        },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );

      const rows = await runsFor(agent.id);
      expect(rows).toHaveLength(3);
      expect(byRunId(rows, '5003').status).toBe('succeeded');
      expect(byRunId(rows, '5001').status).toBe('no_findings');
      expect(byRunId(rows, '5002').status).toBe('failed');
      expect(result.failures.map((f) => f.github_run_id)).toContain('5002');
      expect(result.ingested).toBe(2);
      await app.close();
    });

    it('records a skipped fork run as non-ingested with ZERO rows (AC-40, Rec 3)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: '6001', conclusion: 'skipped' })],
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );

      expect(await runsFor(agent.id)).toHaveLength(0);
      expect(result.skipped).toBe(1);
      expect(result.ingested).toBe(0);
      expect(result.failures).toHaveLength(0);
      // Never downloaded — a skipped run costs nothing beyond the listing.
      expect(github.actionsCalls.some((c) => c.startsWith('downloadArtifact'))).toBe(false);
      await app.close();
    });

    it('records an in-flight run as Running and completes it on a later refresh (AC-49)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: '6500', status: 'in_progress', conclusion: null })],
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
      expect((await runsFor(agent.id))[0]!.status).toBe('running');

      // Same run, now finished — the row is updated, never duplicated.
      const finished = await makeApp({
        github: new MockGitHubClient({
          workflowRuns: [workflowRun({ id: '6500' })],
          artifacts: { '6500': artifactMeta('a-6500') },
          artifactBytes: { 'a-6500': artifactZip(goodResult()) },
        }),
      });
      await finished.app.inject({ method: 'POST', url: '/ci-runs/refresh' });

      const rows = await runsFor(agent.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('succeeded');
      await app.close();
      await finished.app.close();
    });

    it('records a truncated archive as one failed run without stopping the batch (AC-41)', async () => {
      const whole = artifactZip(goodResult());
      const github = new MockGitHubClient({
        workflowRuns: [
          workflowRun({ id: '7002', run_started_at: '2026-08-01T11:00:00Z' }),
          workflowRun({ id: '7001', run_started_at: '2026-08-01T10:00:00Z' }),
        ],
        artifacts: { '7002': artifactMeta('a-7002'), '7001': artifactMeta('a-7001') },
        artifactBytes: {
          'a-7002': whole.slice(0, Math.floor(whole.byteLength / 2)),
          'a-7001': whole,
        },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );

      const rows = await runsFor(agent.id);
      expect(byRunId(rows, '7002').status).toBe('failed');
      expect(byRunId(rows, '7001').status).toBe('succeeded');
      expect(result.ingested).toBe(1);
      expect(result.failures.map((f) => f.github_run_id)).toEqual(['7002']);
      await app.close();
    });

    it('rejects an oversized artifact as failed, leaving the batch intact (AC-41)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: '7500' })],
        artifacts: { '7500': artifactMeta('a-7500') },
        artifactBytes: { 'a-7500': new Uint8Array(ARTIFACT_MAX_BYTES + 10) },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );
      expect(byRunId(await runsFor(agent.id), '7500').status).toBe('failed');
      expect(result.failures[0]!.reason).toMatch(/limit/);
      await app.close();
    });

    it('fails Refresh with the GITHUB_TOKEN config error and changes no data (AC-42)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: '8001' })],
        artifacts: { '8001': artifactMeta('a-8001') },
        artifactBytes: { 'a-8001': artifactZip(goodResult()) },
      });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);
      await app.close();

      // No `github` override at all, and a secrets provider with no token.
      const tokenless = await makeApp({
        github: null,
        secrets: new MockSecretsProvider({}),
      });
      const res = await tokenless.app.inject({ method: 'POST', url: '/ci-runs/refresh' });

      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe('config_error');
      expect(res.json().error.message).toContain('GITHUB_TOKEN');
      expect(await runsFor(agent.id)).toHaveLength(0);
      await tokenless.app.close();
    });

    it('surfaces a distinct Actions-read message on 403 while export keeps working (AC-43)', async () => {
      const github = new MockGitHubClient();
      const { GitHubActionsScopeError } = await import('../../adapters/github/errors.js');
      github.listWorkflowRuns = async () => {
        throw new GitHubActionsScopeError();
      };
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const res = await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('github_actions_scope');
      expect(res.json().error.message).toMatch(/Actions/);
      expect(res.json().error.message).toMatch(/read/i);

      // The export/commit path does NOT need that scope and keeps working.
      const repo2 = await makeRepo();
      const agent2 = await makeAgent();
      const again = await app.inject({
        method: 'POST',
        url: `/agents/${agent2.id}/export-ci`,
        payload: exportBody(repo2.fullName, { action: 'open_pr' }),
      });
      expect(again.statusCode).toBe(200);
      expect(await runsFor(agent.id)).toHaveLength(0);
      await app.close();
    });

    it('ingests exactly REFRESH_MAX_RUNS runs, newest first (AC-44)', async () => {
      const runs: WorkflowRunMeta[] = [];
      const artifacts: Record<string, ArtifactMeta[]> = {};
      const artifactBytes: Record<string, Uint8Array> = {};
      const total = REFRESH_MAX_RUNS + 5;
      for (let i = 0; i < total; i++) {
        // Newest first, as GitHub returns them.
        const id = String(90_000 + (total - i));
        runs.push(
          workflowRun({
            id,
            run_started_at: new Date(Date.UTC(2026, 7, 1, 0, total - i)).toISOString(),
          }),
        );
        artifacts[id] = artifactMeta(`a-${id}`);
        artifactBytes[`a-${id}`] = artifactZip(goodResult());
      }
      const github = new MockGitHubClient({ workflowRuns: runs, artifacts, artifactBytes });
      const { app } = await makeApp({ github });
      const { agent } = await installed(app);

      const result = CiIngestResult.parse(
        (await app.inject({ method: 'POST', url: '/ci-runs/refresh' })).json(),
      );

      expect(result.examined).toBe(REFRESH_MAX_RUNS);
      const rows = await runsFor(agent.id);
      expect(rows).toHaveLength(REFRESH_MAX_RUNS);
      const ingestedIds = new Set(rows.map((r) => r.githubRunId));
      // The NEWEST cap's worth — the oldest 5 are left for a later refresh.
      expect(ingestedIds.has(runs[0]!.id)).toBe(true);
      expect(ingestedIds.has(runs[REFRESH_MAX_RUNS - 1]!.id)).toBe(true);
      expect(ingestedIds.has(runs[REFRESH_MAX_RUNS]!.id)).toBe(false);
      await app.close();
    });

    it('serves the CI Runs list with the chip-row facets (AC-45 – AC-51)', async () => {
      const github = new MockGitHubClient({
        workflowRuns: [workflowRun({ id: '9999' })],
        artifacts: { '9999': artifactMeta('a-9999') },
        artifactBytes: { 'a-9999': artifactZip(goodResult()) },
      });
      const { app } = await makeApp({ github });
      const { agent, repo } = await installed(app);
      await app.inject({ method: 'POST', url: '/ci-runs/refresh' });

      const res = await app.inject({ url: '/ci-runs' });
      expect(res.statusCode).toBe(200);
      const body = CiRunsResponse.parse(res.json());

      const mine = body.runs.find((r) => r.github_run_id === '9999')!;
      expect(mine.repo).toBe(repo.fullName);
      expect(mine.agent).toBe('CI Fixture Agent'); // the artifact's own snapshot
      expect(mine.duration_s).toBe(45);
      expect(mine.github_url).toContain('/actions/runs/9999');
      expect(body.agents.some((a) => a.id === agent.id)).toBe(true);
      expect(body.repos).toContain(repo.fullName);

      const filtered = CiRunsResponse.parse(
        (await app.inject({ url: `/ci-runs?agent_id=${agent.id}` })).json(),
      );
      expect(filtered.runs.every((r) => r.repo === repo.fullName)).toBe(true);
      await app.close();
    });

    it('never exposes another workspace’s CI runs', async () => {
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: uniq('foreign-ws') })
        .returning();
      const [foreignRun] = await pg.handle.db
        .insert(t.ciRuns)
        .values({
          workspaceId: otherWs!.id,
          githubRunId: uniq('foreign'),
          repo: 'someone/else',
          status: 'succeeded',
        })
        .returning();

      const { app } = await makeApp();
      const body = CiRunsResponse.parse((await app.inject({ url: '/ci-runs' })).json());
      expect(body.runs.some((r) => r.id === foreignRun!.id)).toBe(false);
      expect(body.repos).not.toContain('someone/else');
      await app.close();
    });
  });

  // =========================================================================
  // No webhook, no upload (AC-35)
  // =========================================================================

  it('exposes no webhook and no upload ingest route (AC-35)', async () => {
    const { app } = await makeApp();
    for (const url of ['/ci-runs/webhook', '/ci/webhook', '/ci-runs/upload', '/ci-runs/import']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  // ---- helpers ------------------------------------------------------------

  function slugOf(name: string) {
    return name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async function installationsOf(agentId: string) {
    return pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
  }

  async function runsFor(agentId: string) {
    const insts = await installationsOf(agentId);
    if (insts.length === 0) return [];
    const rows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, insts[0]!.id));
    return rows;
  }

  function byRunId(rows: { githubRunId: string }[], id: string) {
    const row = rows.find((r) => r.githubRunId === id);
    if (!row) throw new Error(`no ci_runs row for github run ${id}`);
    return row as (typeof rows)[number] & { status: string | null };
  }
});
