import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Built-in skill catalog used by the seed.
 *
 * A skill is reusable, text-only review guidance: its `body` is a markdown block
 * injected verbatim into an agent's prompt (see reviewer-core assemblePrompt).
 * Descriptions are written DIRECTIVELY — a skill's description is its interface,
 * stating what it makes the reviewer do.
 *
 * `source` records provenance: `manual` = authored here / in the UI; `community`
 * = brought in from outside (an imported archive) — at least one seeded skill is
 * `community` so the import path is represented end to end. A foreign skill is
 * foreign instructions in an agent's prompt, hence the distinct provenance.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'Scores the PR on correctness, tests, docs, and clarity before any merge.',
    type: 'rubric',
    source: 'manual',
    body: `## Skill: PR quality rubric
Hold every change to this bar and call out where it falls short:
- **Correctness** — the change does what it claims and handles the unhappy paths.
- **Tests** — new behaviour is covered by a test that would fail if it regressed.
- **Docs** — public behaviour changes are reflected in comments/docs.
- **Clarity** — names and control flow read cleanly; no needless complexity.
Only raise a finding when a dimension is concretely missing — never a generic nit.`,
  },
  {
    name: 'no-then-chains',
    description: 'Forbids `.then()` promise chains; requires async/await.',
    type: 'convention',
    source: 'manual',
    body: `## Skill: no .then() chains
This codebase uses async/await exclusively. Flag any \`.then()\`/\`.catch()\` promise
chain added in the diff and require it be rewritten with async/await. Severity
SUGGESTION unless the chain hides an unhandled rejection (then WARNING).`,
  },
  {
    name: 'secret-leakage-gate',
    description: 'Blocks any hardcoded secret (sk_live, service_role, tokens, private keys).',
    type: 'security',
    source: 'manual',
    body: `## Skill: secret leakage gate
Treat any literal credential introduced in the diff as CRITICAL: \`sk_live_\` /
\`sk_test_\` keys, \`service_role\` keys, bearer tokens, passwords, \`-----BEGIN ... PRIVATE KEY-----\`,
and connection strings with embedded credentials. Require it be moved to a secret
store and rotated. Do NOT flag obvious placeholders (\`xxx\`, \`<your-key>\`, \`example\`).`,
  },
  {
    name: 'lethal-trifecta',
    description: 'Flags flows combining private data + untrusted input + an exfiltration path.',
    type: 'security',
    source: 'manual',
    body: `## Skill: lethal trifecta
Raise a CRITICAL only when ALL THREE are present in one flow, each with a file:line:
(1) UNTRUSTED content reaches an LLM/agent, (2) that agent can read PRIVATE data,
(3) it has an EXFILTRATION path (outbound call / attacker-readable output). A plain
authenticated \`request → DB read → JSON response\` is NOT a trifecta — do not classify
it as one. When unsure, report as an ordinary access-control finding instead.`,
  },
  {
    name: 'phantom-api-gate',
    description: 'Rejects calls to undefined/hallucinated SDK methods, env vars, or endpoints.',
    type: 'security',
    source: 'manual',
    body: `## Skill: phantom API gate
Flag references the diff introduces that have no definition you can see: a method on
an SDK/client that is not a real API, an env var that is never set, an imported
symbol with no export, a route called but never registered. Require the author point
to where it is defined. Severity WARNING, or CRITICAL when it sits on a security path.`,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Requires a covering test whenever production behaviour changes.',
    type: 'custom',
    source: 'manual',
    body: `## Skill: test coverage nudge
When the diff changes production behaviour but adds/changes no test that exercises
it, raise a WARNING naming the specific behaviour left uncovered and the test file
that should hold it. Pure refactors with unchanged behaviour are exempt.`,
  },
  {
    name: 'uncovered-branches',
    description: 'Flags any conditional branch with no test that drives execution into it.',
    type: 'rubric',
    source: 'manual',
    body: `## Skill: uncovered branches
For every conditional the diff adds or changes (\`if\`/\`else\`, \`?:\`, \`switch\`, \`&&\`/\`||\`
guards, early returns, \`catch\` blocks), check the tests in the same PR drive
execution into BOTH outcomes. If a branch — especially an error/else/empty path —
has no test that reaches it, raise a finding naming that exact branch (file:line)
and the missing case. A test that only covers the happy path while a new guarded
error branch ships untested is CRITICAL.`,
  },
  {
    name: 'edge-case-coverage',
    description: 'Requires tests for boundary inputs: empty, null, zero, negative, max, duplicate.',
    type: 'rubric',
    source: 'manual',
    body: `## Skill: edge-case coverage
For changed functions, check the tests cover the boundary inputs, not just a typical
one: empty string/array/object, null/undefined, zero, negative, the max/overflow
edge, and duplicate/repeated values where relevant. Name each missing boundary case
and the input that triggers it. Severity WARNING, or CRITICAL when the uncovered
boundary leads to a crash or wrong result in production.`,
  },
  {
    name: 'mock-overuse-gate',
    description: 'Catches tests that mock so much they assert on the mock, not the real behaviour.',
    type: 'custom',
    source: 'manual',
    body: `## Skill: mock-overuse gate
Flag a test that mocks the very unit under test, or stubs so much that its assertions
only verify the mock was called rather than that real behaviour is correct. Such a
test passes even when the implementation is broken. Require at least one assertion on
a real output/side-effect. Severity WARNING (CRITICAL if it is the only test guarding
a critical path).`,
  },
  {
    name: 'flaky-test-patterns',
    description: 'Detects non-deterministic tests: real timers, ordering, network, shared state.',
    type: 'rubric',
    // Imported from a community skill pack — provenance is `community`, not `manual`.
    source: 'community',
    body: `## Skill: flaky test patterns
Flag tests likely to flake in CI: dependence on real wall-clock time / \`setTimeout\`
without fake timers, reliance on array/map iteration or filesystem ordering, real
network or external services, shared mutable state across tests, and snapshot
assertions on non-deterministic output. Name the source of non-determinism and a
deterministic alternative.`,
  },
  {
    name: 'api-contract-gate',
    description: 'Blocks breaking changes to a route signature, schema, status code, or auth.',
    type: 'custom',
    source: 'manual',
    body: `## Skill: API contract gate
Compare each changed route/schema against the contract an existing caller relies on.
Raise CRITICAL for a BREAKING change shipped without a version gate or migration:
- a removed or renamed request/response field, route, or query param;
- a field whose type narrows or whose nullability changes;
- a newly REQUIRED request field (callers that omit it now fail);
- a changed success status code or error shape;
- a newly added auth/permission requirement on a previously open route.
Additive, optional, backward-compatible changes are safe — say so explicitly.
Name the exact field/route (file:line) and the caller-visible break.`,
  },
  // ---- API Contract Reviewer's directive skill pack (L03) ----
  {
    name: 'breaking-change',
    description: 'Flags any change or removal of a published public contract callers depend on.',
    type: 'custom',
    source: 'manual',
    body: `## Skill: breaking-change
Treat the removal, rename, or signature change of any PUBLIC, already-shipped
contract as a CRITICAL breaking change unless it is version-gated. This covers
routes, exported functions/types, request params, and event payloads.

BAD (breaking — a caller calling the old path/shape now fails):
\`\`\`
- router.get("/v1/users/:id", getUser)
+ router.get("/v1/people/:id", getUser)   // route renamed, no /v1/users alias
\`\`\`

GOOD (additive — old contract still works):
\`\`\`
  router.get("/v1/users/:id", getUser)        // kept
+ router.get("/v1/people/:id", getUser)       // new alias added alongside
\`\`\`

For each finding name the old contract, the caller-visible break, and whether a
deprecation alias or version gate is missing.`,
  },
  {
    name: 'response-schema',
    description: 'Catches response-shape changes: removed/renamed fields, narrowed types, new required fields.',
    type: 'custom',
    source: 'manual',
    body: `## Skill: response-schema
Compare the new response shape against the one clients parse today. Raise a
finding for any field that is removed, renamed, retyped to a narrower type, or
made newly required, and for a changed success status code or error envelope.

BAD (clients reading \`name\` break):
\`\`\`
- return { id, name, email }
+ return { id, fullName, email }     // "name" renamed → existing clients read undefined
\`\`\`

GOOD (additive — old fields preserved):
\`\`\`
  return { id, name, email, fullName }   // add new field, keep "name"
\`\`\`

Optional, additive fields are safe. Narrowing (e.g. \`string | null\` → \`string\`,
or an enum losing a member) is breaking — call it out with the field path.`,
  },
  {
    name: 'semver-discipline',
    description: 'Requires the version bump (major/minor/patch) to match the contract change.',
    type: 'convention',
    source: 'manual',
    body: `## Skill: semver-discipline
The version bump must match the change. A breaking contract change REQUIRES a
major bump (or an explicit new \`/v2\` namespace); shipping it under a minor/patch
is a finding.

- MAJOR: removed/renamed field or route, narrowed type, new required input,
  changed status code or auth requirement.
- MINOR: backward-compatible additions (new optional field, new route).
- PATCH: internal fix, no contract change.

BAD: a PR that removes a response field but bumps \`1.4.2 → 1.4.3\` (patch).
GOOD: the same removal shipped as \`1.4.2 → 2.0.0\` (major) or behind \`/v2\`.

Cite the contract change and the version bump it landed under, and state the
bump it should have been.`,
  },
  {
    name: 'deprecation-policy',
    description: 'Requires deprecate-then-remove (alias + warning) instead of silently dropping a contract.',
    type: 'convention',
    // Imported from a community pack — provenance is `community`, not `manual`.
    source: 'community',
    body: `## Skill: deprecation-policy
A public contract is retired in two steps, never deleted outright. Flag any PR
that removes a route/field/param without first shipping a deprecation path.

Required when retiring a contract:
1. Keep the old contract working (alias the old route, keep the old field populated).
2. Mark it deprecated (a \`Deprecation\`/\`Sunset\` header, a \`@deprecated\` doc tag, a log warning).
3. Remove only in a later MAJOR version, after the deprecation window.

BAD (silent removal):
\`\`\`
- router.post("/charge", legacyCharge)   // gone in this PR — old clients 404
\`\`\`

GOOD (deprecate first):
\`\`\`
  router.post("/charge", (req, res) => {
+   res.setHeader("Deprecation", "true")           // warn, still works
+   res.setHeader("Sunset", "Wed, 01 Jan 2025 00:00:00 GMT")
    return legacyCharge(req, res)
  })
\`\`\`

Name the removed contract and the missing deprecation step.`,
  },
];

/**
 * Which seeded skills attach to which seeded agent, in prompt order. The order is
 * the order the skill blocks appear in the assembled prompt. Agents reference
 * skills by name; the seed resolves names → ids when it links them.
 */
export const SKILL_LINKS: Record<string, string[]> = {
  'Security Reviewer': ['pr-quality-rubric', 'secret-leakage-gate', 'lethal-trifecta'],
  'Performance Reviewer': ['pr-quality-rubric', 'test-coverage-nudge'],
  'Test Quality Reviewer': [
    'uncovered-branches',
    'edge-case-coverage',
    'mock-overuse-gate',
    'flaky-test-patterns',
  ],
  'API Contract Reviewer': [
    'breaking-change',
    'response-schema',
    'semver-discipline',
    'deprecation-policy',
    'api-contract-gate',
  ],
};
