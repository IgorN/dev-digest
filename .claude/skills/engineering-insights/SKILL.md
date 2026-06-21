---
name: engineering-insights
description: >-
  Capture a durable, non-obvious engineering insight into the touched module's
  INSIGHTS.md (client, server, reviewer-core, e2e) so a future session doesn't
  relearn it. Use the moment you hit something worth keeping during a session — a
  gotcha, a working approach, a dead-end antipattern, a codebase convention, a
  tool/library quirk, a recurring error+fix, or an open question — and again at
  the end of a substantial session, on "wrap up" / "retro", or when the user runs
  /engineering-insights. Reads the target file first, never duplicates, writes
  only substantial file-grounded entries, and is strictly append-only (never
  overwrites or deletes existing content).
---

# Engineering Insights

Record ONE durable engineering insight per finding into the **INSIGHTS.md of the
module the work actually touched**, so the next agent starts where this one left
off instead of relearning it. Read what's already there, add only what's new and
substantial, and never overwrite.

This skill is a no-op when the session was trivial — that is the expected outcome
most of the time. Writing nothing is correct; writing noise is not.

## 1. Where to write (module routing)

Write to the file of the package the work touched:

| Work touched | File |
|---|---|
| client (`@devdigest/web`, Next.js/React) | `client/INSIGHTS.md` |
| server (`@devdigest/api`, Fastify/Drizzle, incl. repo-intel) | `server/INSIGHTS.md` |
| reviewer-core (`@devdigest/reviewer-core`, the engine) | `reviewer-core/INSIGHTS.md` |
| e2e (`@devdigest/e2e`) | `e2e/INSIGHTS.md` |
| several packages at once | split — write each part to its own module file |
| pure root config / CI only | usually not a module insight — skip it |

Never write insights into this `SKILL.md`.

## 2. The 7 sections (one fixed shape per file)

Every `INSIGHTS.md` carries the same headings. Append each entry under the one
that fits:

- **What Works** — an approach that worked here and is worth repeating.
- **What Doesn't Work** — dead ends and antipatterns. *Highest-value, most often
  skipped — prioritize it.* Saving someone a wasted hour beats confirming a win.
- **Codebase Patterns** — conventions and architectural decisions not obvious
  from a quick read.
- **Tool & Library Notes** — dependency quirks, version gotchas, build flags.
- **Recurring Errors & Fixes** — an error you'd plausibly hit again + the fix.
- **Session Notes** — dated session summaries under a `### YYYY-MM-DD` subheading.
- **Open Questions** — unresolved threads worth picking up later.

## 3. Concrete, not banal (the bar)

Test before writing: **"If this were obvious to anyone reading the code, don't
write it."** Every entry must be actionable *cold* — useful to someone with zero
memory of this session.

| ❌ Noise (delete it) | ✅ Useful (keep it) |
|---|---|
| "async can be tricky" | "`Promise.all` on the ingest pipeline times out past ~30 items — batch by 10 with `allSettled`. Evidence: `server/...:NN`" |
| "keep contracts in sync" | "`@devdigest/shared` is vendored as TWO copies — `server/src/vendor/shared` AND `client/src/vendor/shared` — not auto-synced; add a field to both in lock-step. Evidence: `.../contracts/trace.ts`" |

## 4. Entry format

Append a bullet under the matching `##` section:

```
- **YYYY-MM-DD** — <concrete, actionable insight>. Evidence: `path/file.ts:NN`.
```

Session Notes group under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided / discovered, one line per point>
```

Use the real date (it's in the session context — do not invent one).

## 5. Workflow (copy this checklist and work through it)

```
- [ ] 1. Gate — was this session substantial?
- [ ] 2. Read the touched module's INSIGHTS.md (in full)
- [ ] 3. Draft ≤5 candidates, ranked by signal
- [ ] 4. Dedup against what's already there
- [ ] 5. Append survivors (append-only Edit)
- [ ] 6. One-line summary of what was written / skipped
```

1. **Gate.** Did the session solve a problem, make a decision, or surface a
   non-obvious discovery? If not → **write nothing** and stop. Trivial edits,
   pure Q&A, and routine work don't qualify.
2. **Read first.** Open the target `INSIGHTS.md` completely before drafting — you
   need to know what's already captured.
3. **Draft ≤5 candidates**, ranked by signal: user corrections and gotchas
   highest, nice-to-know patterns lowest. Each candidate = the exact line + its
   target section + `file:line` evidence.
4. **Dedup.** Drop anything already covered. If reality now contradicts an old
   entry, add a NEW dated note that supersedes it — never edit the old one.
5. **Append** the survivors. If nothing survives gate + dedup, write nothing.
6. **Summary.** One line: what was written, to which file, what was skipped.

## 6. Append-only write contract (hard rules)

This skill must never clobber existing content:

- **Re-read the target `INSIGHTS.md` immediately before writing** — it may have
  changed since the session started.
- **Insert with an anchored `Edit`** that adds the bullet under the correct `##`
  heading. **Never use `Write` on an existing `INSIGHTS.md`** — `Write` replaces
  the whole file and destroys prior content.
- **Preserve verbatim** the header, the preamble, every section heading, and
  every existing entry. New content is only ever *added*.
- **Corrections are additive** — supersede a wrong entry with a dated note; never
  rewrite or delete the old one.
- **Idempotent** — if an equivalent entry already exists, skip it.

## 7. Maintenance (out of band, not per session)

Append-only means the file grows. Keep it lean separately: prune monthly (drop
fixed-bug, duplicate, never-needed entries), aim for ~30 high-value entries per
file before splitting into domain files, and treat each file as a reviewed draft
— spot-check it, because a wrong entry propagates to every future session until
someone corrects it.
