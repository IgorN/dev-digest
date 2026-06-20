import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Finding } from "@devdigest/shared";
import { FindingsSummary } from "./FindingsSummary";

afterEach(cleanup);

const mkFinding = (o: Partial<Finding> & { id: string; severity: Finding["severity"] }): Finding => ({
  category: "security",
  title: "A finding",
  file: "src/x.ts",
  start_line: 1,
  end_line: 1,
  rationale: "because reasons",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  ...o,
});

describe("FindingsSummary", () => {
  it("renders severity icon-counts from explicit counts", () => {
    render(<FindingsSummary counts={{ CRITICAL: 2, WARNING: 1 }} findings={[]} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it('renders "—" when there are no findings', () => {
    render(<FindingsSummary counts={{}} findings={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("derives counts from findings when counts is omitted", () => {
    render(
      <FindingsSummary
        findings={[
          mkFinding({ id: "f1", severity: "CRITICAL" }),
          mkFinding({ id: "f2", severity: "CRITICAL" }),
        ]}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hovering a severity chip reveals ONLY that severity's findings", () => {
    render(
      <FindingsSummary
        counts={{ CRITICAL: 1, WARNING: 2 }}
        findings={[
          mkFinding({ id: "c1", severity: "CRITICAL", title: "Critical issue" }),
          mkFinding({ id: "w1", severity: "WARNING", title: "Warning one" }),
          mkFinding({ id: "w2", severity: "WARNING", title: "Warning two" }),
        ]}
      />,
    );
    // Nothing shown until a chip is hovered.
    expect(screen.queryByText("Critical issue")).not.toBeInTheDocument();

    // Hover the CRITICAL chip (count "1") → only the critical finding.
    fireEvent.mouseEnter(screen.getByText("1"));
    expect(screen.getByText("Critical issue")).toBeInTheDocument();
    expect(screen.queryByText("Warning one")).not.toBeInTheDocument();

    // Move to the WARNING chip (count "2") → only the two warnings.
    fireEvent.mouseEnter(screen.getByText("2"));
    expect(screen.getByText("Warning one")).toBeInTheDocument();
    expect(screen.getByText("Warning two")).toBeInTheDocument();
    expect(screen.queryByText("Critical issue")).not.toBeInTheDocument();
  });
});
