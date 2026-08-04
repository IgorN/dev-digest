import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlugs, manifestPathFor, skillPathFor } from './slug.js';

describe('slugify (AC-10, AC-11)', () => {
  it('lowercases and hyphen-separates ASCII names', () => {
    expect(slugify('Secret Leakage Gate')).toBe('secret-leakage-gate');
    expect(slugify('API   Contract  Reviewer')).toBe('api-contract-reviewer');
    expect(slugify('  Trailing / Leading  ')).toBe('trailing-leading');
  });

  it('folds Latin diacritics rather than dropping the whole name', () => {
    expect(slugify('Ünïcödé Réviewer')).toBe('unicode-reviewer');
  });

  it('substitutes a deterministic fallback for a name with no ASCII (AC-11)', () => {
    expect(slugify('审查员')).toBe('agent');
    expect(slugify('审查员')).toBe(slugify('审查员'));
    expect(slugify('🙂🙂🙂')).toBe('agent');
    expect(slugify('', 'skill')).toBe('skill');
  });

  it('never yields an empty string', () => {
    for (const name of ['', '   ', '---', '///', '™', '🙂']) {
      expect(slugify(name).length).toBeGreaterThan(0);
    }
  });
});

describe('uniqueSlugs (AC-10)', () => {
  it('disambiguates a collision deterministically by link order', () => {
    const names = ['Secret Leakage Gate', 'secret-leakage gate'];
    const first = uniqueSlugs(names);
    expect(first).toEqual(['secret-leakage-gate', 'secret-leakage-gate-2']);
    // Stable across repeated generations — the commit API cannot delete files,
    // so a shifting filename would orphan the previous one forever.
    expect(uniqueSlugs(names)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it('handles three-way collisions and empty-slug collisions', () => {
    expect(uniqueSlugs(['A B', 'a-b', 'a  b'])).toEqual(['a-b', 'a-b-2', 'a-b-3']);
    expect(uniqueSlugs(['审查', '🙂'], 'skill')).toEqual(['skill', 'skill-2']);
  });

  it('avoids colliding with a literal slug that already looks disambiguated', () => {
    const out = uniqueSlugs(['Gate', 'gate-2', 'Gate']);
    expect(new Set(out).size).toBe(3);
    expect(out[0]).toBe('gate');
    expect(out[1]).toBe('gate-2');
    expect(out[2]).not.toBe('gate-2');
  });
});

describe('paths', () => {
  it('builds the manifest and skill paths', () => {
    expect(manifestPathFor('Security Reviewer')).toBe(
      '.devdigest/agents/security-reviewer.yaml',
    );
    expect(manifestPathFor('审查员')).toBe('.devdigest/agents/agent.yaml');
    expect(skillPathFor('secret-leakage-gate')).toBe(
      '.devdigest/skills/secret-leakage-gate.md',
    );
  });
});
