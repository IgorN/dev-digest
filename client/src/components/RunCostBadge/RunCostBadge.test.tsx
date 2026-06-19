import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";

/**
 * RunCostBadge is the single source of truth for how a run's cost reads in the
 * three UI spots (PR-list COST column, timeline row, verdict accordion). The
 * load-bearing checklist rule: a run WITHOUT usage data shows "—", never
 * "$0.00" — those mean different things (unknown vs genuinely free).
 */
afterEach(cleanup);

describe("RunCostBadge", () => {
  it('no cost data → "—", never "$0.00"', () => {
    const { container } = render(<RunCostBadge costUsd={null} />);
    expect(container.textContent).toBe("—");
    expect(container.textContent).not.toContain("$0.00");
  });

  it("treats undefined cost as no data", () => {
    const { container } = render(<RunCostBadge costUsd={undefined} />);
    expect(container.textContent).toBe("—");
  });

  it("a genuine zero cost renders $0.00 (distinct from no-data —)", () => {
    const { container } = render(<RunCostBadge costUsd={0} />);
    expect(container.textContent).toBe("$0.00");
  });

  it("compact variant keeps enough precision for sub-cent runs", () => {
    const { container } = render(<RunCostBadge costUsd={0.0013} variant="compact" />);
    expect(container.textContent).toBe("$0.0013");
  });

  it("full variant appends the in→out token summary", () => {
    const { container } = render(
      <RunCostBadge costUsd={0.014} tokensIn={8200} tokensOut={1300} variant="full" />,
    );
    expect(container.textContent).toBe("$0.014 · 8.2K→1.3K");
  });

  it("tokens-cost variant shows total tokens then cost (timeline row)", () => {
    const { container } = render(
      <RunCostBadge costUsd={0.0013} tokensIn={8000} tokensOut={1119} variant="tokens-cost" />,
    );
    expect(container.textContent).toBe(`${(9119).toLocaleString()} tok · $0.0013`);
  });
});
