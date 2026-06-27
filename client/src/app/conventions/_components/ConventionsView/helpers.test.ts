import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { acceptedCount } from "./helpers";

const c = (over: Partial<ConventionCandidate>): ConventionCandidate => ({
  id: "x",
  rule: "r",
  evidence_path: "p",
  evidence_snippet: "s",
  confidence: 0.9,
  accepted: null,
  ...over,
});

describe("acceptedCount", () => {
  it("counts only accepted=true (not null or false)", () => {
    const list = [c({ accepted: true }), c({ accepted: false }), c({ accepted: null }), c({ accepted: true })];
    expect(acceptedCount(list)).toBe(2);
  });
});
