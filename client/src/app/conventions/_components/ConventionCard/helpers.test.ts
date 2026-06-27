import { describe, it, expect } from "vitest";
import { confidenceColor, evidenceLabel } from "./helpers";

describe("confidenceColor", () => {
  it("high → ok, mid → warn, low → muted", () => {
    expect(confidenceColor(0.91)).toBe("var(--ok)");
    expect(confidenceColor(0.78)).toBe("var(--warn, #f59e0b)");
    expect(confidenceColor(0.4)).toBe("var(--text-muted)");
  });
});

describe("evidenceLabel", () => {
  it("formats a line range, a single line, and a bare path", () => {
    expect(evidenceLabel("src/a.ts", 23, 31)).toBe("src/a.ts:23-31");
    expect(evidenceLabel("src/a.ts", 7, 7)).toBe("src/a.ts:7");
    expect(evidenceLabel("src/a.ts", null, null)).toBe("src/a.ts");
  });
});
