import YAML from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { CiAgentInput } from './types.js';

/**
 * DOMAIN CORE — pure `AgentManifest` construction + YAML emission. Zero I/O.
 *
 * The studio WRITES this shape and the CI runner READS it, both through the
 * SAME `AgentManifest` Zod schema (AC-8), so there is no "slightly different
 * prompt in CI": the artifact the runner reads is byte-for-byte what was
 * written here.
 */

/**
 * Build the manifest object.
 *
 * `post_as` is DELIBERATELY absent (AC-19): it travels to CI as the
 * `DEVDIGEST_POST_AS` workflow env var, not inside a committed file. Nothing
 * secret-shaped is written either (AC-9) — the manifest carries only the four
 * things a tuned agent is: model, system prompt, skill slugs, settings.
 */
export function buildManifest(agent: CiAgentInput, skillSlugs: string[]): AgentManifest {
  return AgentManifest.parse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    // An EMPTY array serialises as `skills: []`, which is what AC-12 wants —
    // the runner's schema normalises both a missing key and an explicit null.
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  });
}

/**
 * Serialise to YAML. `lineWidth: 0` disables folding so a long system prompt is
 * never silently re-wrapped, and multi-line prompts come out as block scalars —
 * hand-rolling that escaping is a silent-failure class that would only surface
 * inside a stranger's CI run.
 */
export function renderManifest(manifest: AgentManifest): string {
  return YAML.stringify(manifest, { lineWidth: 0 });
}

/** Convenience: build + render in one step. */
export function renderAgentManifest(agent: CiAgentInput, skillSlugs: string[]): string {
  return renderManifest(buildManifest(agent, skillSlugs));
}
