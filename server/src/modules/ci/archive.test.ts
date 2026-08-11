import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { zipFiles, readArtifactJson, ArtifactError } from './archive.js';
import { ARTIFACT_FILE, ARTIFACT_MAX_BYTES, REFRESH_MAX_RUNS } from './constants.js';

describe('zipFiles (AC-78)', () => {
  it('round-trips the exact file set, contents byte-identical', () => {
    const files = [
      { path: '.devdigest/agents/reviewer.yaml', contents: 'name: Reviewer\n' },
      { path: '.devdigest/memory.jsonl', contents: '' },
      { path: '.devdigest/runner/index.js', contents: 'export const x = 1;\n// ünïcödé\n' },
      { path: '.github/workflows/devdigest-review.yml', contents: 'name: DevDigest Review\n' },
    ];

    const bytes = zipFiles(files);
    const back = unzipSync(bytes);

    expect(Object.keys(back).sort()).toEqual(files.map((f) => f.path).sort());
    for (const f of files) {
      expect(strFromU8(back[f.path]!)).toBe(f.contents);
    }
  });
});

describe('readArtifactJson (AC-41)', () => {
  const goodArtifact = { findings_count: 2, cost_usd: 0.01, agent: 'Reviewer' };

  function archiveOf(json: unknown, name = ARTIFACT_FILE): Uint8Array {
    return zipSync({ [name]: strToU8(JSON.stringify(json)) });
  }

  it('extracts and parses the named entry', () => {
    expect(readArtifactJson(archiveOf(goodArtifact))).toEqual(goodArtifact);
  });

  it('rejects an archive over the cap BEFORE decompressing', () => {
    const oversized = new Uint8Array(ARTIFACT_MAX_BYTES + 1);
    expect(() => readArtifactJson(oversized)).toThrow(ArtifactError);
    expect(() => readArtifactJson(oversized)).toThrow(/over the .* limit/);
  });

  it('rejects an entry whose declared uncompressed size exceeds the cap (zip bomb)', () => {
    // Highly compressible payload: tiny archive, huge inflated size.
    const bomb = zipSync({ [ARTIFACT_FILE]: strToU8('a'.repeat(ARTIFACT_MAX_BYTES + 1024)) });
    expect(bomb.byteLength).toBeLessThan(ARTIFACT_MAX_BYTES);
    expect(() => readArtifactJson(bomb)).toThrow(ArtifactError);
    expect(() => readArtifactJson(bomb)).toThrow(/no readable/);
  });

  it('rejects a truncated / non-extractable archive with a readable reason', () => {
    const whole = archiveOf(goodArtifact);
    const truncated = whole.slice(0, Math.floor(whole.byteLength / 2));
    expect(() => readArtifactJson(truncated)).toThrow(ArtifactError);
  });

  it('rejects an empty archive', () => {
    expect(() => readArtifactJson(new Uint8Array(0))).toThrow(/empty/);
  });

  it('rejects an archive with no devdigest-result.json entry', () => {
    expect(() => readArtifactJson(archiveOf(goodArtifact, 'something-else.json'))).toThrow(
      /no readable devdigest-result\.json/,
    );
  });

  it('rejects a present-but-unparseable entry', () => {
    const broken = zipSync({ [ARTIFACT_FILE]: strToU8('{not json') });
    expect(() => readArtifactJson(broken)).toThrow(/not valid JSON/);
  });
});

describe('constants (AC-44)', () => {
  it('exports REFRESH_MAX_RUNS as a named constant', () => {
    expect(REFRESH_MAX_RUNS).toBe(30);
    expect(ARTIFACT_MAX_BYTES).toBe(256 * 1024);
  });
});
