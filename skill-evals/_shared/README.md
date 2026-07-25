# skill-evals — shared convention

This folder holds **no skill-specific data**. Every skill's eval scenario
lives with the skill itself, at `.claude/skills/<skill-name>/evals/`, so it
travels with the skill when it's packaged (`/plugin`) or copied into another
project. This folder is only the shared convention + (eventually) the runner
that walks all of them.

## Layout convention

```
.claude/skills/<skill-name>/
├── SKILL.md, references/...   ← the skill itself, unchanged by evaluation
└── evals/
    ├── eval.md                ← task prompt + grading method + pass threshold
    ├── expected-findings.json ← answer key: violations by file/line/rule
    └── fixtures/               ← the fake module(s) under test — no hint comments
```

A skill opts into CI evaluation simply by having an `evals/` folder in this
shape — no central registration file, no list to keep in sync.

## Grading method

Default metric is **recall** against `expected-findings.json`: run the task
prompt from `eval.md`, then check for each expected finding whether the
output identifies the same file and the same underlying issue. `recall =
matched / total`; the scenario passes at `recall >= pass_threshold` (0.9 by
default — tune per skill in that skill's `expected-findings.json`).

Not every skill's output is a findings list — for skills with subjective or
generative output (writing style, codegen), a different `eval.md`/grading
shape is fine; the recall-over-findings pattern above is the default for
review/audit-style skills.

## Runner (TODO)

Not written yet. When it exists, it should glob
`.claude/skills/*/evals/eval.md`, and for each match: run that scenario's
task prompt against its `fixtures/`, grade against `expected-findings.json`,
and fail CI if `recall < pass_threshold`. Wiring it in is future work — this
folder exists so the convention is settled before the runner is.
