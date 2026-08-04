import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { AppError } from '../../platform/errors.js';
import { ARTIFACT_FILE, ARTIFACT_MAX_BYTES } from './constants.js';

/**
 * INFRASTRUCTURE — zip creation (the wizard's manual fallback, AC-78) and zip
 * extraction (the Actions artifact download, AC-41).
 *
 * The extraction side reads UNTRUSTED bytes produced inside someone else's CI,
 * so it is bounded twice: the compressed archive must fit under the cap, and
 * each entry's declared uncompressed size is checked BEFORE it is inflated (a
 * 256 KB archive can otherwise inflate to gigabytes).
 */

export class ArtifactError extends AppError {
  constructor(message: string, details?: unknown) {
    super('ci_artifact_invalid', message, 422, details);
    this.name = 'ArtifactError';
  }
}

export interface ArchiveFile {
  path: string;
  contents: string;
}

/**
 * Build a zip of the generated file set. `mtime` is pinned to the zip epoch so
 * two exports of the same file set produce byte-identical archives (the zip
 * format's minimum representable date is 1980-01-01; `0` is rejected).
 */
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

export function zipFiles(files: ArchiveFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);
  return zipSync(entries, { level: 6, mtime: ZIP_EPOCH });
}

/**
 * Extract `entryName` from an Actions artifact archive and JSON-parse it.
 *
 * Throws `ArtifactError` (never a generic 500) for every rejection reason, so
 * the ingest can record THAT run as failed with a readable reason and carry on
 * with the rest of the batch (AC-40, AC-41).
 */
export function readArtifactJson(
  bytes: Uint8Array,
  maxBytes: number = ARTIFACT_MAX_BYTES,
  entryName: string = ARTIFACT_FILE,
): unknown {
  // Bound the archive BEFORE handing it to the inflater.
  if (bytes.byteLength > maxBytes) {
    throw new ArtifactError(
      `Result artifact is ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new ArtifactError('Result artifact archive is empty.');
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      // Only the one named entry, and only if its DECLARED uncompressed size
      // fits the cap — this is the decompression bound, checked pre-inflate.
      filter: (file) =>
        basename(file.name) === entryName && file.originalSize <= maxBytes,
    });
  } catch (err) {
    throw new ArtifactError(
      `Result artifact archive is not extractable: ${(err as Error).message}`,
    );
  }

  const key = Object.keys(unzipped).find((k) => basename(k) === entryName);
  if (!key) {
    throw new ArtifactError(
      `Result artifact archive contains no readable ${entryName} within ${maxBytes} bytes.`,
    );
  }

  const raw = unzipped[key]!;
  if (raw.byteLength > maxBytes) {
    throw new ArtifactError(
      `${entryName} is ${raw.byteLength} bytes, over the ${maxBytes}-byte limit.`,
    );
  }

  try {
    return JSON.parse(strFromU8(raw));
  } catch (err) {
    throw new ArtifactError(`${entryName} is not valid JSON: ${(err as Error).message}`);
  }
}

/** Last path segment, tolerant of both separators (zip entries use `/`). */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(i + 1);
}
