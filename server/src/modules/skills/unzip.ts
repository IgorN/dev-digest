import { inflateRawSync } from 'node:zlib';

/**
 * A dependency-free, READ-ONLY zip reader — deliberately minimal.
 *
 * It walks the central directory to LIST entries, and decompresses ONLY the
 * specific text entries the caller asks for (the skill's markdown core). It
 * never executes anything and never even decompresses binaries/scripts — those
 * are reported to the caller as ignored. This is the security posture for skill
 * import: "executable parts of an archive are not processed."
 *
 * Supports the two compression methods a normal `zip` produces: stored (0) and
 * deflate (8). Anything else is treated as "can't read" and surfaced as ignored.
 */

export interface ZipEntry {
  name: string;
  /** Compression method: 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Hard cap on a decompressed entry (defends against a deflate "zip bomb": a tiny
 *  archive that inflates to gigabytes and OOMs the process). A skill body is text;
 *  1 MiB is far more than any real skill needs. */
const MAX_ENTRY_BYTES = 1024 * 1024;

/** Cap on central-directory entries we'll enumerate, so a crafted EOCD count
 *  can't make us allocate a huge entry array. */
const MAX_ENTRIES = 2000;

/** Locate the End Of Central Directory record by scanning backwards from EOF. */
function findEocd(buf: Buffer): number {
  // EOCD is 22 bytes + an optional comment (<= 65535). Scan the tail.
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** List every entry in the archive's central directory (no decompression). */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const total = Math.min(buf.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const entries: ZipEntry[] = [];

  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read and decompress a single entry to a UTF-8 string. Throws when the entry
 * uses an unsupported compression method — the caller treats that as "ignored".
 */
export function readZipEntryText(buf: Buffer, entry: ZipEntry): string {
  const lo = entry.localHeaderOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LOC_SIG) {
    throw new Error(`bad local header for ${entry.name}`);
  }
  // Reject before doing any work if the header already claims a huge output —
  // an O(1) guard that makes the common zip-bomb shape inert.
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`entry ${entry.name} is too large (${entry.uncompressedSize} bytes)`);
  }
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    if (data.length > MAX_ENTRY_BYTES) throw new Error(`entry ${entry.name} is too large`);
    return data.toString('utf8'); // stored
  }
  // deflate — cap the inflate output too, in case the header under-reported size.
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString('utf8');
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}
