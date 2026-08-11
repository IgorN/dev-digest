import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { buildManifest, renderAgentManifest, renderManifest } from './manifest.js';
import type { CiAgentInput } from './types.js';

const agent: CiAgentInput = {
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'openrouter/deepseek-v4-flash',
  systemPrompt: 'You review pull requests.\n\nRules:\n- be terse\n- cite lines\n',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};

describe('manifest (AC-8, AC-9, AC-12, AC-19)', () => {
  it('round-trips through the SAME AgentManifest schema the runner uses (AC-8)', () => {
    const yaml = renderAgentManifest(agent, ['secret-leakage-gate']);
    const parsed = AgentManifest.parse(YAML.parse(yaml));

    expect(parsed.name).toBe('Security Reviewer');
    expect(parsed.provider).toBe('openrouter');
    expect(parsed.model).toBe('openrouter/deepseek-v4-flash');
    expect(parsed.system_prompt).toBe(agent.systemPrompt);
    expect(parsed.skills).toEqual(['secret-leakage-gate']);
    expect(parsed.strategy).toBe('single-pass');
    expect(parsed.ci_fail_on).toBe('critical');
  });

  it('fails the same schema when a field is deliberately corrupted (AC-8)', () => {
    const doc = YAML.parse(renderAgentManifest(agent, []));
    doc.provider = 'not-a-provider';
    expect(AgentManifest.safeParse(doc).success).toBe(false);

    const doc2 = YAML.parse(renderAgentManifest(agent, []));
    doc2.name = '';
    expect(AgentManifest.safeParse(doc2).success).toBe(false);
  });

  it('carries NO post_as key — that value travels as a workflow env var (AC-19)', () => {
    const yaml = renderAgentManifest(agent, ['a']);
    const doc = YAML.parse(yaml) as Record<string, unknown>;
    expect(Object.keys(doc)).not.toContain('post_as');
    expect(yaml).not.toMatch(/post_as/);
    expect(yaml).not.toMatch(/DEVDIGEST_POST_AS/);
  });

  it('emits an EMPTY skills list for a zero-skill agent, and it re-parses (AC-12)', () => {
    const yaml = renderAgentManifest(agent, []);
    expect(yaml).toContain('skills: []');
    expect(AgentManifest.parse(YAML.parse(yaml)).skills).toEqual([]);
  });

  it('preserves a multi-line system prompt exactly (no folding, no re-wrapping)', () => {
    const long = 'x'.repeat(400);
    const wordy: CiAgentInput = {
      ...agent,
      systemPrompt: `line one\nline two: with a colon\n  indented\n${long}`,
    };
    const parsed = AgentManifest.parse(YAML.parse(renderAgentManifest(wordy, [])));
    expect(parsed.system_prompt).toBe(wordy.systemPrompt);
  });

  it('writes no secret, key or token into the manifest (AC-9)', () => {
    const yaml = renderAgentManifest(agent, ['a', 'b']);
    for (const pattern of [
      /OPENROUTER_API_KEY/,
      /GITHUB_TOKEN/,
      /ANTHROPIC_API_KEY/,
      /OPENAI_API_KEY/,
      /sk-[A-Za-z0-9]{8,}/,
      /gh[ps]_[A-Za-z0-9]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ]) {
      expect(yaml).not.toMatch(pattern);
    }
  });

  it('buildManifest normalizes through the schema before rendering', () => {
    const m = buildManifest(agent, []);
    expect(m.skills).toEqual([]);
    expect(renderManifest(m)).toBe(renderAgentManifest(agent, []));
  });
});
