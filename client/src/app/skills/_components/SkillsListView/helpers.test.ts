import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { filterSkills } from "./helpers";

const mk = (over: Partial<Skill>): Skill => ({
  id: "x",
  name: "name",
  description: "desc",
  type: "custom",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

describe("filterSkills", () => {
  const skills = [
    mk({ id: "1", name: "uncovered-branches", type: "rubric", description: "branch coverage" }),
    mk({ id: "2", name: "secret-leakage-gate", type: "security", description: "no secrets" }),
  ];

  it("returns all when the query is blank", () => {
    expect(filterSkills(skills, "  ")).toHaveLength(2);
  });

  it("matches on name, description, and type (case-insensitive)", () => {
    expect(filterSkills(skills, "SECRET").map((s) => s.id)).toEqual(["2"]);
    expect(filterSkills(skills, "rubric").map((s) => s.id)).toEqual(["1"]);
    expect(filterSkills(skills, "coverage").map((s) => s.id)).toEqual(["1"]);
  });
});
