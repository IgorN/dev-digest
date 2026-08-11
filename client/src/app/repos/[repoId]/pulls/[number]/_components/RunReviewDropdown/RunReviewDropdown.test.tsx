/**
 * RunReviewDropdown — the PR-page multi-agent picker.
 *
 * Guards the four behaviours that are invisible in the design screenshots:
 * enabled-only listing, all-checked-on-open, the Clear/Select all TOGGLE, and
 * the count-conditional launch label. `fireEvent`, not `userEvent` —
 * @testing-library/user-event is not installed in this project.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentRunEstimate } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";

const h = vi.hoisted(() => ({
  agents: [] as { id: string; name: string; model: string; enabled: boolean }[],
  estimates: [] as AgentRunEstimate[],
  mutateAsync: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: h.agents }),
}));
vi.mock("@/lib/hooks/multi-runs", () => ({
  useAgentEstimates: () => ({ data: h.estimates }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

function estimate(o: Partial<AgentRunEstimate> & { agent_id: string }): AgentRunEstimate {
  return {
    agent_name: o.agent_id,
    avg_duration_ms: null,
    avg_cost_usd: null,
    duration_sample_count: 0,
    cost_sample_count: 0,
    last_summary: null,
    ...o,
  };
}

beforeEach(() => {
  h.agents = [
    { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
    { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true },
    { id: "a3", name: "Retired", model: "gpt-4.1", enabled: false },
  ];
  h.estimates = [
    estimate({ agent_id: "a1", agent_name: "Security", avg_duration_ms: 8200, duration_sample_count: 3 }),
    estimate({ agent_id: "a2", agent_name: "Performance" }),
  ];
  h.mutateAsync = vi.fn().mockResolvedValue({ runs: [{ run_id: "r1" }], multi_run_id: "mr-1" });
  h.push = vi.fn();
});
afterEach(cleanup);

function renderPicker() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ prReview, multiAgent }}>
      <RunReviewDropdown prId="pr1" />
    </NextIntlClientProvider>,
  );
  return view;
}

function openPicker() {
  renderPicker();
  fireEvent.click(screen.getByText("Run Review"));
}

const rows = () => screen.getAllByRole("checkbox");
/** The panel's launch button, addressed by its (count-conditional) label — the
   trigger button is "Run Review", so every label below is unambiguous. */
const launchButton = (name: string) => screen.getByRole("button", { name });

describe("RunReviewDropdown — agent picker", () => {
  it("renders the trigger label and opens the panel", () => {
    renderPicker();
    expect(screen.getByText("Run Review")).toBeInTheDocument();
    expect(screen.queryByText("Pick agents to run")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.getByText("Pick agents to run")).toBeInTheDocument();
  });

  it("lists only ENABLED agents, all pre-checked on open (AC-17)", () => {
    openPicker();
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Security" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Performance" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox", { name: "Retired" })).not.toBeInTheDocument();
  });

  it("the header link is a TOGGLE: Clear when all are selected, Select all otherwise (AC-16, AC-21)", () => {
    openPicker();
    expect(screen.getByText("Clear")).toBeInTheDocument();

    // Clearing everything sets N to 0 and flips the link.
    fireEvent.click(screen.getByText("Clear"));
    expect(rows().every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByText("Select all")).toBeInTheDocument();
    expect(launchButton("Select an agent")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Select all"));
    expect(rows().every((r) => r.getAttribute("aria-checked") === "true")).toBe(true);
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("unchecking one row flips the link to Select all without clearing the rest", () => {
    openPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(screen.getByRole("checkbox", { name: "Security" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Performance" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Select all")).toBeInTheDocument();
  });

  it("the launch label is count-conditional and disabled at zero (AC-19, AC-20)", () => {
    openPicker();
    expect(launchButton("Run multi-agent review (2)")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));
    expect(launchButton("Run Security")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(launchButton("Select an agent")).toBeDisabled();

    fireEvent.click(launchButton("Select an agent"));
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it("renders a history-derived hint, and — for an agent with no estimate (AC-18)", () => {
    openPicker();
    expect(within(screen.getByRole("checkbox", { name: "Security" })).getByText("~8.2s")).toBeInTheDocument();
    expect(within(screen.getByRole("checkbox", { name: "Performance" })).getByText("—")).toBeInTheDocument();
  });

  it("launching posts the explicit agent set and navigates to the multi-run result (AC-32)", async () => {
    const onRunsStarted = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview, multiAgent }}>
        <RunReviewDropdown prId="pr1" onRunsStarted={onRunsStarted} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("Run Review"));
    fireEvent.click(launchButton("Run multi-agent review (2)"));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/multi-agent-review/mr-1"));
    expect(h.mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(onRunsStarted).toHaveBeenCalledWith(["r1"]);
  });

  it("a workspace with zero enabled agents renders the empty state with the button disabled", () => {
    h.agents = [{ id: "a3", name: "Retired", model: "gpt-4.1", enabled: false }];
    openPicker();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText(/No agents enabled/)).toBeInTheDocument();
    expect(launchButton("Select an agent")).toBeDisabled();
  });

  it("offers the Configure agents… footer", () => {
    openPicker();
    fireEvent.click(screen.getByText("Configure agents…"));
    expect(h.push).toHaveBeenCalledWith("/agents");
  });
});
