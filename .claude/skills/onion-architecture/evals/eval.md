# onion-architecture — eval scenario

Ships alongside the skill (`.claude/skills/onion-architecture/evals/`) so it
travels with it — packaged via `/plugin`, or copied into another project's
`.claude/skills/onion-architecture/`. No project-specific wiring lives here;
only the shared runner convention in
[`skill-evals/_shared/README.md`](../../../../skill-evals/_shared/README.md)
does that.

## Task prompt

> I've drafted three new backend modules for DevDigest — `webhooks`,
> `digest-summary`, and `team-directory` (see `fixtures/` next to this file;
> each has `routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`,
> `constants.ts`). None are merged yet. Before I open PRs for them, can you
> review the code and flag anything that violates our backend layering
> conventions?

Give the runner (human or agent) read access to `fixtures/` plus the rest of
the repo for context (so it can compare against a real module like
`server/src/modules/repos/` if it wants). The task is read-only — no fixture
file should be modified.

## Fixtures

`fixtures/webhooks/`, `fixtures/digest-summary/`, `fixtures/team-directory/` —
three small draft modules, each shaped like a real DevDigest feature module.
Between them they carry **9 planted onion-architecture violations**, one
instance of nearly every entry in
[`references/violations.md`](../references/violations.md). The fixture code
itself carries no hint comments — the answer key lives separately in
[`expected-findings.json`](expected-findings.json).

## Grading

Score with **recall** against `expected-findings.json`: for each expected
finding, check whether the review output names the same file and describes
the same underlying issue (exact wording and line citation aren't required —
identifying the right construct is).

```
recall = matched_findings / total_findings   (9 total)
pass   = recall >= 0.9
```

With 9 total findings, 0.9 recall means the review has to catch all 9 to pass
— tighten `pass_threshold` in `expected-findings.json` first if that's too
strict for a given CI gate.

## Comparing with/without the skill

To test whether the skill actually changes the outcome, run the task prompt
twice against the same fixtures — once with the `onion-architecture` skill
available (let it trigger naturally; the prompt matches its "review a backend
PR for layering" trigger condition), once with skill use explicitly disabled
(instruct the reviewer not to consult any project skill) — and compare recall
between the two runs.
