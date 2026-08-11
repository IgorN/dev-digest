import type { CiFile } from '@devdigest/shared';
import { MEMORY_PATH, RUNNER_DIR, WORKFLOW_PATH } from './constants.js';
import { renderAgentManifest } from './manifest.js';
import { skillPathFor, uniqueSlugs, SKILL_SLUG_FALLBACK } from './slug.js';
import { renderWorkflow } from './workflow.js';
import type { BuildFileSetInput } from './types.js';

/**
 * DOMAIN CORE — pure file-set assembly. Zero I/O by construction: the runner
 * bytes arrive as an ARGUMENT (read by `runner-bundle.ts`), so the entire
 * security-relevant generation path — manifest, workflow, slugs, the exact path
 * list — is a pure function unit tests exercise with no filesystem, no database
 * and no GitHub.
 */

/**
 * The EXACT file set of AC-7, in a stable order, and no other file:
 *   1. the manifest at the installation's PINNED `.devdigest/agents/<slug>.yaml`
 *   2. one `.devdigest/skills/<slug>.md` per linked ENABLED skill
 *   3. a zero-byte `.devdigest/memory.jsonl`
 *   4. every runner build file, verbatim, under `.devdigest/runner/`
 *   5. `.github/workflows/devdigest-review.yml`
 *
 * Only the workflow is `editable` (AC-70). Runner entries carry their REAL
 * bytes here — the response-shaped elision happens in `toPreviewFiles` (AC-71).
 */
export function buildFileSet(input: BuildFileSetInput): CiFile[] {
  const {
    agent,
    skills,
    runnerFiles,
    manifestPath,
    triggers,
    postAs,
    workflowVersion,
    workflowOverride,
  } = input;

  // A disabled linked skill is excluded from BOTH the files and the manifest
  // list, matching how a local run assembles skills (AC-7). Filter BEFORE
  // slugging so disambiguation is by the enabled set's own link order (AC-10).
  const enabled = skills.filter((s) => s.enabled);
  const slugs = uniqueSlugs(
    enabled.map((s) => s.name),
    SKILL_SLUG_FALLBACK,
  );

  const files: CiFile[] = [];

  files.push({
    path: manifestPath,
    contents: renderAgentManifest(agent, slugs),
    editable: false,
    placeholder: null,
  });

  enabled.forEach((skill, i) => {
    files.push({
      path: skillPathFor(slugs[i]!),
      contents: skill.body,
      editable: false,
      placeholder: null,
    });
  });

  // AC-16: present, zero bytes, and referenced by nothing in the manifest.
  files.push({ path: MEMORY_PATH, contents: '', editable: false, placeholder: null });

  // AC-13/AC-14: every emitted file, verbatim, never rewritten or renamed.
  for (const runner of runnerFiles) {
    files.push({
      path: `${RUNNER_DIR}/${runner.path}`,
      contents: runner.contents,
      editable: false,
      placeholder: null,
    });
  }

  files.push({
    path: WORKFLOW_PATH,
    // AC-70/AC-72: use the hand-edited workflow when the client sent one,
    // regenerate otherwise. The server never silently keeps a stale copy.
    contents:
      workflowOverride && workflowOverride.length > 0
        ? workflowOverride
        : renderWorkflow({ triggers, postAs, workflowVersion }),
    editable: true,
    placeholder: null,
  });

  return files;
}

/**
 * Response shaping (AC-71): runner entries lose their contents and gain a size
 * marker, so the browser never receives ~1.6 MB of bundle text. The FULL set
 * (with real bytes) is what reaches the commit and zip paths.
 */
export function toPreviewFiles(files: CiFile[]): CiFile[] {
  return files.map((f) =>
    isRunnerFile(f.path)
      ? {
          ...f,
          contents: '',
          placeholder: formatBytes(Buffer.byteLength(f.contents, 'utf8')),
        }
      : f,
  );
}

export function isRunnerFile(path: string): boolean {
  return path.startsWith(`${RUNNER_DIR}/`);
}

/** Total UTF-8 size of the runner entries — stated on the Install step. */
export function runnerBytes(files: CiFile[]): number {
  return files
    .filter((f) => isRunnerFile(f.path))
    .reduce((n, f) => n + Buffer.byteLength(f.contents, 'utf8'), 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
