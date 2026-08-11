import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { buildFileSet, toPreviewFiles, runnerBytes, formatBytes } from './generation.js';
import { manifestPathFor } from './slug.js';
import type { BuildFileSetInput, CiAgentInput, CiSkillInput } from './types.js';

const agent: CiAgentInput = {
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'openrouter/deepseek-v4-flash',
  systemPrompt: 'You review pull requests.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};

const runnerFiles = [
  { path: 'index.js', contents: 'export const entry = 1;\n' },
  { path: '300.index.js', contents: 'export const chunk = 2;\n' },
  { path: 'package.json', contents: '{"type":"module"}' },
];

const skill = (name: string, enabled = true): CiSkillInput => ({
  name,
  body: `# ${name}\n\nRules go here.\n`,
  enabled,
});

function input(over: Partial<BuildFileSetInput> = {}): BuildFileSetInput {
  return {
    agent,
    skills: [],
    runnerFiles,
    manifestPath: manifestPathFor(agent.name),
    triggers: ['opened', 'synchronize'],
    postAs: 'github_review',
    workflowVersion: 1,
    ...over,
  };
}

describe('buildFileSet (AC-7, AC-12, AC-13, AC-14, AC-16, AC-70)', () => {
  it('produces the EXACT AC-7 path list for an agent with two skills, and nothing else', () => {
    const files = buildFileSet(
      input({ skills: [skill('Secret Leakage Gate'), skill('Phantom API Detector')] }),
    );

    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/secret-leakage-gate.md',
      '.devdigest/skills/phantom-api-detector.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.devdigest/runner/300.index.js',
      '.devdigest/runner/package.json',
      '.github/workflows/devdigest-review.yml',
    ]);
  });

  it('excludes a DISABLED linked skill from both the files and the manifest (AC-7)', () => {
    const files = buildFileSet(
      input({ skills: [skill('Enabled One'), skill('Disabled One', false)] }),
    );

    expect(files.map((f) => f.path)).toContain('.devdigest/skills/enabled-one.md');
    expect(files.map((f) => f.path)).not.toContain('.devdigest/skills/disabled-one.md');

    const manifest = AgentManifest.parse(YAML.parse(files[0]!.contents));
    expect(manifest.skills).toEqual(['enabled-one']);
  });

  it('emits no skills directory and an empty skills list for a zero-skill agent (AC-12)', () => {
    const files = buildFileSet(input({ skills: [skill('Off', false)] }));
    expect(files.some((f) => f.path.startsWith('.devdigest/skills/'))).toBe(false);
    expect(AgentManifest.parse(YAML.parse(files[0]!.contents)).skills).toEqual([]);
  });

  it('keeps the manifest skills list in exact agreement with the filenames (AC-10)', () => {
    const files = buildFileSet(
      input({ skills: [skill('Secret Leakage Gate'), skill('secret-leakage gate')] }),
    );
    const manifest = AgentManifest.parse(YAML.parse(files[0]!.contents));
    const skillPaths = files
      .filter((f) => f.path.startsWith('.devdigest/skills/'))
      .map((f) => f.path);

    expect(manifest.skills).toEqual(['secret-leakage-gate', 'secret-leakage-gate-2']);
    expect(skillPaths).toEqual(manifest.skills.map((s) => `.devdigest/skills/${s}.md`));
  });

  it('ships .devdigest/memory.jsonl at zero bytes, unreferenced by the manifest (AC-16)', () => {
    const files = buildFileSet(input());
    const memory = files.find((f) => f.path === '.devdigest/memory.jsonl')!;
    expect(memory.contents).toBe('');
    expect(Buffer.byteLength(memory.contents, 'utf8')).toBe(0);
    expect(files[0]!.contents).not.toContain('memory.jsonl');
  });

  it('copies every runner file byte-for-byte under .devdigest/runner/ (AC-13, AC-14)', () => {
    const files = buildFileSet(input());
    for (const rf of runnerFiles) {
      const out = files.find((f) => f.path === `.devdigest/runner/${rf.path}`)!;
      expect(out).toBeDefined();
      expect(out.contents).toBe(rf.contents);
      expect(Buffer.from(out.contents, 'utf8')).toEqual(Buffer.from(rf.contents, 'utf8'));
    }
    expect(files.filter((f) => f.path.startsWith('.devdigest/runner/'))).toHaveLength(3);
  });

  it('uses the PINNED manifest path even after the agent is renamed (AC-3)', () => {
    const files = buildFileSet(
      input({
        agent: { ...agent, name: 'Renamed Reviewer' },
        manifestPath: '.devdigest/agents/security-reviewer.yaml',
      }),
    );
    const manifests = files.filter((f) => f.path.startsWith('.devdigest/agents/'));
    expect(manifests).toHaveLength(1);
    expect(manifests[0]!.path).toBe('.devdigest/agents/security-reviewer.yaml');
    expect(AgentManifest.parse(YAML.parse(manifests[0]!.contents)).name).toBe(
      'Renamed Reviewer',
    );
  });

  it('marks ONLY the workflow editable (AC-70)', () => {
    const files = buildFileSet(input({ skills: [skill('A')] }));
    const editable = files.filter((f) => f.editable);
    expect(editable.map((f) => f.path)).toEqual(['.github/workflows/devdigest-review.yml']);
  });

  it('uses the hand-edited workflow when one is supplied, regenerates otherwise (AC-70)', () => {
    const edited = '# my own workflow\nname: Mine\n';
    const withOverride = buildFileSet(input({ workflowOverride: edited }));
    expect(withOverride.at(-1)!.contents).toBe(edited);

    const withoutOverride = buildFileSet(input({ workflowOverride: '' }));
    expect(withoutOverride.at(-1)!.contents).toContain('name: DevDigest Review');
  });

  it('is deterministic — two generations of the same input are identical', () => {
    const a = buildFileSet(input({ skills: [skill('One'), skill('Two')] }));
    const b = buildFileSet(input({ skills: [skill('One'), skill('Two')] }));
    expect(a).toEqual(b);
  });

  it('writes no secret-shaped literal into ANY generated file (AC-9, AC-18)', () => {
    const files = buildFileSet(input({ skills: [skill('Secret Leakage Gate')] }));
    const patterns = [
      /sk-[A-Za-z0-9]{8,}/,
      /gh[ps]_[A-Za-z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const f of files) {
      for (const p of patterns) expect(f.contents).not.toMatch(p);
    }

    // The only place a credential NAME may appear is a `${{ secrets.… }}`
    // expression inside the workflow.
    for (const f of files) {
      for (const line of f.contents.split('\n')) {
        if (/OPENROUTER_API_KEY|GITHUB_TOKEN/.test(line) && !line.trim().startsWith('#')) {
          expect(f.path).toBe('.github/workflows/devdigest-review.yml');
          expect(line).toContain('${{ secrets.');
        }
      }
    }
  });
});

describe('toPreviewFiles (AC-71)', () => {
  it('elides runner contents and substitutes a size marker', () => {
    const full = buildFileSet(input({ skills: [skill('A')] }));
    const preview = toPreviewFiles(full);

    expect(preview.map((f) => f.path)).toEqual(full.map((f) => f.path));
    for (const f of preview) {
      if (f.path.startsWith('.devdigest/runner/')) {
        expect(f.contents).toBe('');
        expect(f.placeholder).toMatch(/\d/);
      } else {
        expect(f.placeholder).toBeNull();
        expect(f.contents).toBe(full.find((x) => x.path === f.path)!.contents);
      }
    }
    // Not one byte of bundle text survives into the response shape.
    expect(JSON.stringify(preview)).not.toContain('export const entry');
  });

  it('reports the runner byte total', () => {
    const full = buildFileSet(input());
    expect(runnerBytes(full)).toBe(
      runnerFiles.reduce((n, f) => n + Buffer.byteLength(f.contents, 'utf8'), 0),
    );
  });
});

describe('formatBytes', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_600_000)).toBe('1.5 MB');
  });
});
