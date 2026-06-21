# reviewer-core (`@devdigest/reviewer-core`)

The pure review engine. No I/O. npm (not pnpm).

## Before answering
Search `reviewer-core/docs/`, `reviewer-core/INSIGHTS.md`, and
`reviewer-core/README.md` for the topic before reading code.

## Conventions (not obvious from code)
- **No I/O.** The engine takes inputs and returns a result — no network, no DB,
  no filesystem. Side effects belong in the server. Keep it deterministic and
  unit-testable.
- The grounding gate (`src/grounding.ts`) filters findings against the diff before
  they're returned — never bypass it; ungrounded findings must not reach callers.
- Token/cost data on the outcome is best-effort: it's null when the provider
  doesn't expose usage. Callers must handle null (the server persists it as-is).
- Consumed by the server via tsconfig path alias to source — there is no build
  step in the dev loop, but `reviewer-core/node_modules` MUST be installed
  (`npm ci`) or the API crashes on import.

## Do-not-touch (without coordination)
- The grounding gate's contract — it's the safety boundary for finding quality.

## Use when
- Overview, the review flow → `reviewer-core/README.md`
- Deep-dives (pipeline, prompts, contracts) → `reviewer-core/docs/`
- Gotchas/findings → `reviewer-core/INSIGHTS.md`
- Tests: `npm test`. Typecheck: `npm run typecheck`.
