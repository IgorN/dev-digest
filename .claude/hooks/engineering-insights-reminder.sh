#!/usr/bin/env bash
# Stop hook — engineering-insights nudge.
#
# Lightweight & NON-BLOCKING. When a turn ends, if any of the four packages has
# uncommitted changes (i.e. real code work happened this session), inject a
# reminder for the next turn to capture insights. On a clean tree (pure Q&A, no
# code touched) it stays silent. It never blocks the turn, so there is no
# infinite-loop risk — `additionalContext` is delivered, the turn still ends.
#
# Contract: Stop hooks take no matcher; non-blocking context is returned via
# {"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "..."}}.
set -euo pipefail

# Drain the Stop event JSON from stdin; we don't need its fields.
cat >/dev/null 2>&1 || true

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -z "${root:-}" ] && exit 0

# Did the work touch a module? Look for uncommitted changes under the 4 packages.
changed="$(git -C "$root" status --porcelain -- server client reviewer-core e2e 2>/dev/null || true)"
[ -z "$changed" ] && exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"engineering-insights reminder: this session has uncommitted changes under a module. If anything non-obvious came up (a gotcha, a fix, a decision, a pattern, an antipattern, an open question), run the engineering-insights skill to append it to that module's INSIGHTS.md (append-only, read first, no duplicates). If the work was trivial, skip it — writing nothing is fine."}}
JSON
exit 0
