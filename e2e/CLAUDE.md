# e2e (`@devdigest/e2e`)

Deterministic browser end-to-end suite. npm.

## Before answering
Search `e2e/docs/`, `e2e/specs/`, `e2e/INSIGHTS.md`, and `e2e/README.md` for the
topic before reading code.

## Conventions (not obvious from code)
- Requires the FULL stack running (server :3001 + client :3000) and a seeded DB —
  see `./scripts/dev.sh`. The suite is not hermetic on its own.
- Tests are written to be deterministic; when one flakes, fix the root cause
  (waits/fixtures) and record it in `e2e/INSIGHTS.md` — don't add blind retries.

## Use when
- Overview, how to run → `e2e/README.md`
- Scenarios / acceptance → `e2e/specs/`
- Setup & flake fixes → `e2e/docs/` and `e2e/INSIGHTS.md`
