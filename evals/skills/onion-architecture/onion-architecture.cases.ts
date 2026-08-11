import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillCase } from "../../src/index.js";
import { SKILLS_DIR } from "../../src/index.js";

// Fixtures live with the skill itself (.claude/skills/onion-architecture/evals/fixtures/), not
// copied under evals/ — they travel with the skill when it's packaged/exported. Read straight
// from there instead of the usual colocated fixtureReader().
const FIXTURES_DIR = join(SKILLS_DIR, "onion-architecture", "evals", "fixtures");
const fx = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

// skillTask injects SKILL.md + references/*.md as the system prompt but gives the model NO
// tools (it measures the skill's content in isolation) — so the fixture modules have to be
// inlined here, the same way dependency-checker inlines its synthetic repo data.
const MODULE_FILES = ["constants.ts", "helpers.ts", "repository.ts", "service.ts", "routes.ts"];

function renderModule(name: string): string {
  return MODULE_FILES.map((file) => `\`\`\`ts
// ${name}/${file}
${fx(`${name}/${file}`)}\`\`\``).join("\n\n");
}

// Three draft modules carrying 9 planted onion-architecture violations between them — one
// instance of nearly every entry in references/violations.md. No hint comments in the fixture
// code itself; the answer key lives in .claude/skills/onion-architecture/evals/expected-findings.json.
const REVIEW_PROMPT = `I've drafted three new backend modules for DevDigest — webhooks, digest-summary, and team-directory. None are merged yet. Before I open PRs for them, can you review the code and flag anything that violates our backend layering conventions? There's no live repo to read here — these files are everything there is to look at.

## webhooks/

${renderModule("webhooks")}

## digest-summary/

${renderModule("digest-summary")}

## team-directory/

${renderModule("team-directory")}`;

export const cases: SkillCase[] = [
  {
    name: "flags all 9 planted onion-architecture violations across the three draft modules",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags webhooks/routes.ts running a raw Drizzle query against webhookDeliveries directly in the route handler instead of delegating to the service/repository",
      "flags webhooks/service.ts reading the webhook secret via process.env.GITHUB_WEBHOOK_SECRET instead of through container.secrets",
      "flags webhooks/routes.ts hand-building a 401 error envelope (reply.status(401).send({ error: ... })) instead of throwing a typed domain error",
      "flags digest-summary/helpers.ts's enrichWithAuthor performing a database call (awaiting db.select()) inside what is meant to be a pure helper",
      "flags digest-summary/repository.ts's saveSummary making a business/orchestration decision (checking for an existing row and conditionally calling container.jobs.enqueue) instead of only persisting data",
      "flags digest-summary/service.ts's generate accepting a Fastify reply object and calling reply.status(...) directly instead of returning data for routes.ts to map to a status code",
      "flags team-directory/service.ts importing and instantiating RepoRepository directly from the repos module instead of reaching repo data through the container's shared capability",
      "flags team-directory/service.ts constructing a GitHub client adapter directly (e.g. new OctokitGitHubClient(token)) instead of pulling it off the container",
      "flags team-directory/repository.ts's list() (and/or the upsertMember lookup) not scoping its query by workspaceId, i.e. missing tenancy scoping",
    ],
    threshold: 0.9,
    maxTurns: 10,
  },
  {
    name: "does not fabricate violations in the parts of the modules that are actually clean",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not claim webhooks/helpers.ts or webhooks/repository.ts contain an I/O-in-the-wrong-layer or business-logic violation — those two files are correctly layered",
      "does not claim team-directory/helpers.ts performs any I/O or business logic — it is a pure mapper with no such issue",
      "every finding names a specific file and construct rather than a vague, unattributed complaint",
    ],
    threshold: 0.8,
    maxTurns: 10,
  },
];
