/**
 * `classifyFile` (smart-diff/classify.ts) — pure path/pattern classification,
 * no I/O. Table-driven over the three roles. The lock-file case gets the most
 * breadth deliberately: "a lock file at ANY path depth MUST classify as
 * boilerplate" is called out in the plan as the single hardest, graded
 * acceptance criterion for this feature (server/src/modules/smart-diff/
 * classify.ts, constants.ts).
 */
import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/classify.js';
import type { SmartDiffRole } from '@devdigest/shared';

/** Assert every path in the list classifies as `role`. */
function expectRole(paths: string[], role: SmartDiffRole) {
  for (const path of paths) {
    expect(classifyFile(path), `expected "${path}" -> ${role}`).toBe(role);
  }
}

describe('classifyFile', () => {
  describe('boilerplate — lock files at any nesting depth (hard requirement)', () => {
    it('pnpm-lock.yaml at root and at arbitrary nesting depths', () => {
      expectRole(
        [
          'pnpm-lock.yaml',
          'packages/foo/pnpm-lock.yaml',
          'apps/web/nested/deep/pnpm-lock.yaml',
          'a/b/c/d/e/f/pnpm-lock.yaml',
        ],
        'boilerplate',
      );
    });

    it('package-lock.json at root and nested', () => {
      expectRole(
        ['package-lock.json', 'packages/bar/package-lock.json', 'apps/api/server/package-lock.json'],
        'boilerplate',
      );
    });

    it('yarn.lock at root and nested', () => {
      expectRole(['yarn.lock', 'services/api/yarn.lock', 'packages/ui/nested/yarn.lock'], 'boilerplate');
    });

    it('does NOT match a filename that merely contains a lock-file name as a substring', () => {
      // "mypnpm-lock.yaml" and "pnpm-lock.yaml.bak" are not the real lock file —
      // the (^|/) anchor + trailing $ must not over-match.
      expectRole(['src/mypnpm-lock.yaml', 'pnpm-lock.yaml.bak'], 'core');
    });

    it('boilerplate is checked BEFORE wiring, so a lock file under a CI/config-looking directory still wins', () => {
      // Mirrors classify.ts's own doc comment: "a lock file living under an
      // otherwise wiring-looking directory still classifies as boilerplate".
      expectRole(['.github/workflows/pnpm-lock.yaml'], 'boilerplate');
    });
  });

  describe('boilerplate — snapshots + generated build output', () => {
    it('*.snap anywhere in the tree', () => {
      expectRole(
        ['src/__snapshots__/Component.test.tsx.snap', 'a/b/c/deep.snap', 'App.snap'],
        'boilerplate',
      );
    });

    it('dist/, build/, .next/, out/, coverage/ at root and nested', () => {
      expectRole(
        [
          'dist/index.js',
          'packages/foo/dist/index.js',
          'build/main.js',
          'client/build/static/js/main.js',
          '.next/static/chunk.js',
          'apps/web/.next/server/pages.js',
          'out/index.html',
          'coverage/lcov.info',
        ],
        'boilerplate',
      );
    });

    it('does not match a directory whose name merely contains "dist"/"build" as a substring', () => {
      expectRole(['src/mydist/foo.ts', 'src/rebuilder/index_notreally.ts'], 'core');
    });
  });

  describe('wiring — config / index barrels / project metadata / CI', () => {
    it('index barrels', () => {
      expectRole(['src/index.ts', 'src/modules/foo/index.js', 'lib/index.mjs'], 'wiring');
    });

    it('tsconfig variants', () => {
      expectRole(
        ['tsconfig.json', 'tsconfig.build.json', 'packages/api/tsconfig.build.json'],
        'wiring',
      );
    });

    it('package.json at root and nested (not package-lock.json)', () => {
      expectRole(['package.json', 'packages/foo/package.json'], 'wiring');
    });

    it('tool config files', () => {
      expectRole(
        ['vite.config.ts', 'tailwind.config.js', 'apps/web/next.config.mjs', '.eslintrc.json', '.prettierrc'],
        'wiring',
      );
    });

    it('CI + container wiring', () => {
      expectRole(
        [
          '.github/workflows/ci.yml',
          '.gitlab-ci.yml',
          'Dockerfile',
          'Dockerfile.prod',
          'docker-compose.yml',
          'docker-compose.override.yaml',
        ],
        'wiring',
      );
    });
  });

  describe('core — ordinary business-logic source', () => {
    it('classifies typical source files as core', () => {
      expectRole(
        [
          'src/services/payment.ts',
          'server/src/modules/reviews/service.ts',
          'client/src/components/Button.tsx',
        ],
        'core',
      );
    });
  });

  describe('core — unmatched path defaults (fail-open toward more review attention)', () => {
    it('an unusual/unmatched path defaults to core, never boilerplate or wiring', () => {
      expectRole(['README.md', 'LICENSE', 'some/random/path/thing.xyz', 'Makefile.custom'], 'core');
    });
  });
});
