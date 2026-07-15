# Insights — reviewer-core (`@devdigest/reviewer-core`)

Non-obvious findings and gotchas for the review engine. Add an entry whenever
something surprised you, so the next agent/session doesn't relearn it.
Append-only — see the `engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-07-15** — `OpenRouterProvider.complete()` (`src/llm/openrouter.ts`) is an intentional always-throwing stub — the class docstring says "Only completeStructured is needed by reviewPullRequest; the rest are stubs," but nothing enforces that at compile time, and `MockLLMProvider` (used across the server's test suite) implements `.complete()` fine, so a new server module that calls `.complete()` instead of `.completeStructured()` passes every test and only fails live against the real adapter. Bit a new `server/src/modules/blast/summarize.ts` this way — fixed by switching to `completeStructured({model, schema, schemaName, messages, ...})`. If another `LLMProvider` method is ever added as a real stub, consider making it throw a more greppable/typed error, or narrowing the interface so unsupported methods aren't even callable. Evidence: `src/llm/openrouter.ts`.

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
