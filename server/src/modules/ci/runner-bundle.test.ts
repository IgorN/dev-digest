import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunnerBundle, RunnerBundleError, RUNNER_BUILD_COMMAND } from './runner-bundle.js';

/**
 * T3 / AC-13, AC-14, AC-15, AC-15a.
 *
 * These NEVER point at the real `agent-runner/dist` — the suite must not depend
 * on that package having been built, and must never write into it.
 */

const roots: string[] = [];

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ci-runner-'));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('readRunnerBundle', () => {
  it('returns every emitted file with byte-identical contents (AC-13, AC-14)', async () => {
    const dir = await tmp();
    // Mirrors the real shape: entry module + a build-generated chunk whose name
    // must never be hard-coded + the `{"type":"module"}` marker.
    const fixture = {
      'index.js': 'export const entry = 1;\n// ünïcödé ✓\n',
      '742.index.js': 'export const chunk = 2;\n',
      'package.json': '{"type":"module"}',
    };
    for (const [name, body] of Object.entries(fixture)) {
      await writeFile(join(dir, name), body, 'utf8');
    }

    const files = await readRunnerBundle(dir);

    expect(files.map((f) => f.path).sort()).toEqual([
      '742.index.js',
      'index.js',
      'package.json',
    ]);
    for (const f of files) {
      expect(f.contents).toBe(fixture[f.path as keyof typeof fixture]);
      expect(Buffer.from(f.contents, 'utf8')).toEqual(
        Buffer.from(fixture[f.path as keyof typeof fixture], 'utf8'),
      );
    }
  });

  it('ships nested build output too, with POSIX-relative paths', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'index.js'), 'a', 'utf8');
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'x.js'), 'b', 'utf8');

    const files = await readRunnerBundle(dir);
    expect(files.map((f) => f.path)).toEqual(['assets/x.js', 'index.js']);
  });

  it('throws naming the build command when the directory is missing (AC-15)', async () => {
    const dir = join(await tmp(), 'does-not-exist');
    await expect(readRunnerBundle(dir)).rejects.toThrow(RunnerBundleError);
    await expect(readRunnerBundle(dir)).rejects.toThrow(RUNNER_BUILD_COMMAND);
    await expect(readRunnerBundle(dir)).rejects.toThrow('cd agent-runner && pnpm build');
  });

  it('throws the same class of error when the directory is empty (AC-15)', async () => {
    const dir = await tmp();
    await expect(readRunnerBundle(dir)).rejects.toThrow(RunnerBundleError);
    await expect(readRunnerBundle(dir)).rejects.toThrow(RUNNER_BUILD_COMMAND);
  });

  // `chmod 000` does not deny root, so this assertion is only meaningful as a
  // non-root user (which is how the suite runs everywhere it matters).
  const canDenyRead = typeof process.getuid === 'function' && process.getuid!() !== 0;

  it.skipIf(!canDenyRead)('fails the WHOLE read — never a partial set — when one file is unreadable (AC-15a)', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'index.js'), 'entry', 'utf8');
    await writeFile(join(dir, '300.index.js'), 'chunk', 'utf8');
    await writeFile(join(dir, 'package.json'), '{"type":"module"}', 'utf8');
    // Make exactly ONE emitted file unreadable.
    await chmod(join(dir, '300.index.js'), 0o000);

    let result: unknown;
    let error: unknown;
    try {
      result = await readRunnerBundle(dir);
    } catch (err) {
      error = err;
    }

    // The critical assertion: NOTHING is produced. A partial array here would
    // ship an entry module without its lazily-imported chunk.
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(RunnerBundleError);
    expect((error as Error).message).toContain(RUNNER_BUILD_COMMAND);

    await chmod(join(dir, '300.index.js'), 0o644);
  });
});
