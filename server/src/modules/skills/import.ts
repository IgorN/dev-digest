import type { SkillImportPreview, SkillType } from '@devdigest/shared';
import { SkillType as SkillTypeSchema } from '@devdigest/shared';
import { listZipEntries, readZipEntryText, type ZipEntry } from './unzip.js';

/**
 * Skill import = parse the "core" of an uploaded markdown file or zip archive
 * into a preview, WITHOUT persisting anything and WITHOUT running anything.
 *
 * Trust note: an imported skill is foreign instructions that will sit in an
 * agent's prompt. So import is a read-only, confirm-to-save flow: this module
 * only extracts text and returns a preview. For archives we decompress ONLY the
 * markdown core; every other entry (scripts, binaries, anything executable) is
 * listed in `ignored_files` and never processed.
 */

const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;
const TEXT_RE = /\.(md|markdown|mdx|txt|text)$/i;

/** A skill imported from a file/archive is foreign — mark it `community`. */
const IMPORT_SOURCE = 'community' as const;

/** Split YAML-ish frontmatter (`--- ... ---`) off the top; returns meta + body. */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  if (!m) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: normalized.slice(m[0].length).trim() };
}

/** Coerce a frontmatter `type` to a valid SkillType; default to 'custom'. */
function coerceType(raw: string | undefined): SkillType {
  const parsed = SkillTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'custom';
}

/** Derive a human name from a path: `skills/foo/SKILL.md` → `foo`, `bar.md` → `bar`. */
function nameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const base = parts[parts.length - 1] ?? path;
  if (/^skill\.md$/i.test(base) && parts.length >= 2) return parts[parts.length - 2]!;
  return base.replace(MARKDOWN_RE, '').replace(/\.[^.]+$/, '');
}

/** Parse one markdown document into a skill core (name/description/type/body). */
function parseMarkdownCore(text: string, fallbackPath: string) {
  const { meta, body } = parseFrontmatter(text);
  const name = meta.name || nameFromPath(fallbackPath) || 'Imported skill';
  const description =
    meta.description ||
    // else: first markdown heading or first non-empty line, trimmed of leading #'s
    (body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '').replace(/^#+\s*/, '').trim();
  const type = coerceType(meta.type);
  return { name, description, type, body };
}

/** True for zip data — the local-file-header magic "PK\x03\x04". */
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** Pick the skill's markdown entry from an archive: prefer SKILL.md, else the
 *  shallowest/first *.md. Directory entries (trailing "/") are skipped. */
function pickSkillEntry(entries: ZipEntry[]): ZipEntry | undefined {
  const md = entries.filter((e) => !e.name.endsWith('/') && MARKDOWN_RE.test(e.name));
  const skillMd = md.find((e) => /(^|\/)skill\.md$/i.test(e.name));
  if (skillMd) return skillMd;
  return md.sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
}

function previewFromMarkdown(filename: string, text: string): SkillImportPreview {
  const core = parseMarkdownCore(text, filename);
  return {
    ...core,
    source: IMPORT_SOURCE,
    ignored_files: [],
    notes: `Imported from markdown file "${filename}".`,
  };
}

function previewFromZip(filename: string, buf: Buffer): SkillImportPreview {
  const entries = listZipEntries(buf).filter((e) => !e.name.endsWith('/'));
  const chosen = pickSkillEntry(entries);
  if (!chosen) {
    throw new Error('archive contains no markdown skill (looked for SKILL.md or *.md)');
  }
  const ignored = entries.filter((e) => e.name !== chosen.name).map((e) => e.name);
  const core = parseMarkdownCore(readZipEntryText(buf, chosen), chosen.name);
  const note =
    `Extracted "${chosen.name}" from archive "${filename}".` +
    (ignored.length
      ? ` ${ignored.length} other file(s) were NOT processed (executable/non-markdown content is never run).`
      : '');
  return { ...core, source: IMPORT_SOURCE, ignored_files: ignored, notes: note };
}

/**
 * Build an import PREVIEW from an uploaded file's bytes. Detects markdown vs zip
 * by magic bytes (falling back to the filename), extracts the skill core, and
 * lists any archive entries that were ignored. Throws on unreadable input — the
 * route maps that to a 422.
 */
export function buildImportPreview(filename: string, buf: Buffer): SkillImportPreview {
  if (isZip(buf) || /\.zip$/i.test(filename)) return previewFromZip(filename, buf);
  if (TEXT_RE.test(filename) || looksLikeText(buf)) {
    return previewFromMarkdown(filename, buf.toString('utf8'));
  }
  throw new Error('unsupported file: expected a markdown (.md) file or a .zip archive');
}

/** Heuristic: treat as text when the head has no NUL byte. */
function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8000));
  return !head.includes(0);
}
