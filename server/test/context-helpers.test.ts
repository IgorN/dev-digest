import { describe, it, expect } from 'vitest';
import {
  approxTokens,
  truncateToBytes,
  isPathSafe,
  isMarkdownPath,
  matchRoot,
} from '../src/modules/context/helpers.js';
import { TRUNCATION_MARKER } from '../src/modules/context/constants.js';
import { loadConfig } from '../src/platform/config.js';

describe('approxTokens', () => {
  it('is ceil(len/4)', () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(1)).toBe(1);
    expect(approxTokens(4)).toBe(1);
    expect(approxTokens(5)).toBe(2);
    expect(approxTokens(65536)).toBe(16384);
  });

  it('clamps negative/garbage lengths to 0', () => {
    expect(approxTokens(-10)).toBe(0);
    expect(approxTokens(Number.NaN)).toBe(0);
  });
});

describe('truncateToBytes', () => {
  it('returns content unchanged under the cap', () => {
    expect(truncateToBytes('hello', 64)).toEqual({ text: 'hello', truncated: false });
  });

  it('returns content unchanged exactly at the cap', () => {
    expect(truncateToBytes('abcd', 4)).toEqual({ text: 'abcd', truncated: false });
  });

  it('caps by BYTES and appends the visible marker', () => {
    const { text, truncated } = truncateToBytes('a'.repeat(100), 10);
    expect(truncated).toBe(true);
    expect(text).toBe('a'.repeat(10) + TRUNCATION_MARKER);
  });

  it('never splits a multi-byte code point', () => {
    // '€' is 3 bytes in UTF-8; a 4-byte cap lands mid-second-euro.
    const { text, truncated } = truncateToBytes('€€€', 4);
    expect(truncated).toBe(true);
    expect(text).toBe('€' + TRUNCATION_MARKER);
    expect(text).not.toContain('�');
  });
});

describe('isPathSafe', () => {
  it('accepts normal repo-relative paths', () => {
    expect(isPathSafe('docs/intro.md')).toBe(true);
    expect(isPathSafe('server/specs/2026/feature.md')).toBe(true);
    expect(isPathSafe('README.md')).toBe(true);
  });

  it('rejects traversal, absolute, backslash, and empty paths', () => {
    expect(isPathSafe('')).toBe(false);
    expect(isPathSafe('../../etc/passwd')).toBe(false);
    expect(isPathSafe('docs/../../etc/passwd')).toBe(false);
    expect(isPathSafe('/etc/passwd')).toBe(false);
    expect(isPathSafe('C:/windows/system32')).toBe(false);
    expect(isPathSafe('docs\\intro.md')).toBe(false);
    expect(isPathSafe('docs/./intro.md')).toBe(false);
    expect(isPathSafe('docs//intro.md')).toBe(false);
    expect(isPathSafe('docs/intro.md\0')).toBe(false);
  });
});

describe('isMarkdownPath', () => {
  it('matches .md case-insensitively, nothing else', () => {
    expect(isMarkdownPath('docs/a.md')).toBe(true);
    expect(isMarkdownPath('docs/A.MD')).toBe(true);
    expect(isMarkdownPath('docs/a.mdx')).toBe(false);
    expect(isMarkdownPath('docs/a.ts')).toBe(false);
  });
});

describe('matchRoot', () => {
  const roots = ['specs', 'docs', 'insights'];

  it('matches a configured root directory at any depth', () => {
    expect(matchRoot('docs/intro.md', roots)).toBe('docs');
    expect(matchRoot('server/specs/feature.md', roots)).toBe('specs');
    expect(matchRoot('a/b/insights/notes.md', roots)).toBe('insights');
  });

  it('does not match filenames, non-roots, or an empty root set', () => {
    expect(matchRoot('docs.md', roots)).toBeNull(); // file, not a directory
    expect(matchRoot('random/notes.md', roots)).toBeNull();
    expect(matchRoot('docs/intro.md', [])).toBeNull();
  });

  it('shallowest matching segment wins', () => {
    expect(matchRoot('docs/specs/a.md', roots)).toBe('docs');
  });
});

describe('config keys (contextRoots / contextDocMaxBytes)', () => {
  const base = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;

  it('defaults to specs/docs/insights and 65536 bytes', () => {
    const cfg = loadConfig(base);
    expect(cfg.contextRoots).toEqual(['specs', 'docs', 'insights']);
    expect(cfg.contextDocMaxBytes).toBe(65536);
  });

  it('parses CONTEXT_ROOTS as a trimmed comma list and CONTEXT_DOC_MAX_BYTES as int', () => {
    const cfg = loadConfig({
      ...base,
      CONTEXT_ROOTS: ' adr , rfc ,',
      CONTEXT_DOC_MAX_BYTES: '1024',
    } as NodeJS.ProcessEnv);
    expect(cfg.contextRoots).toEqual(['adr', 'rfc']);
    expect(cfg.contextDocMaxBytes).toBe(1024);
  });

  it('empty CONTEXT_ROOTS falls back to the default set', () => {
    const cfg = loadConfig({ ...base, CONTEXT_ROOTS: '' } as NodeJS.ProcessEnv);
    expect(cfg.contextRoots).toEqual(['specs', 'docs', 'insights']);
  });
});
