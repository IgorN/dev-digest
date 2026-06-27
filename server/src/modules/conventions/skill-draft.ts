import type { ConventionRow } from '../../db/rows.js';

/**
 * Merge accepted convention candidates into a single `repo-conventions` skill
 * body (the "Create skill from conventions" modal pre-fill). Pure — no I/O. The
 * draft is editable before the user saves it via the normal create-skill flow.
 */

export interface SkillDraft {
  name: string;
  description: string;
  type: 'convention';
  body: string;
  count: number;
}

/** Short kebab heading derived from a rule, e.g. "Always use async/await instead
 *  of .then() chains" → "always-use-async-await". */
function slug(rule: string): string {
  return (
    rule
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 5)
      .join('-') || 'rule'
  );
}

export function buildSkillDraft(repoName: string, accepted: ConventionRow[]): SkillDraft {
  const name = `${repoName}-conventions`;
  const intro =
    `# ${name}\n\n` +
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below ` +
    `and cite the offending \`file:line\`.`;

  const sections = accepted.map((c) => {
    const heading = c.category ? `${c.category} · ${slug(c.rule)}` : slug(c.rule);
    const range =
      c.evidenceStartLine != null
        ? `${c.evidencePath}:${c.evidenceStartLine}${
            c.evidenceEndLine && c.evidenceEndLine !== c.evidenceStartLine
              ? `-${c.evidenceEndLine}`
              : ''
          }`
        : c.evidencePath;
    // Render evidence as a 4-space-indented code block (not a ``` fence) so a
    // snippet that itself contains ``` can't break out into raw markdown.
    const snippet = (c.evidenceSnippet ?? '')
      .trim()
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
    const evidence = c.evidencePath ? `\n\nDetected in \`${range}\`:\n\n${snippet}` : '';
    return `## ${heading}\n${c.rule}${evidence}`;
  });

  const body = [intro, ...sections].join('\n\n') + '\n';
  return {
    name,
    description: `${accepted.length} house conventions extracted from ${repoName}`,
    type: 'convention',
    body,
    count: accepted.length,
  };
}
