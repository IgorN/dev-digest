import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SeverityFilter } from "./SeverityFilter";

afterEach(cleanup);

describe("SeverityFilter", () => {
  it("renders a chip per severity that has findings, skipping zero counts", () => {
    render(
      <SeverityFilter
        counts={{ CRITICAL: 3, WARNING: 5, SUGGESTION: 0 }}
        active={null}
        onSelect={() => {}}
      />,
    );
    // counts render as text; SUGGESTION (0) is omitted → two chips.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders nothing when there are no findings", () => {
    const { container } = render(
      <SeverityFilter counts={{}} active={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a severity on click and clears it when the active chip is clicked", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SeverityFilter counts={{ CRITICAL: 2 }} active={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("CRITICAL");

    rerender(<SeverityFilter counts={{ CRITICAL: 2 }} active="CRITICAL" onSelect={onSelect} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
