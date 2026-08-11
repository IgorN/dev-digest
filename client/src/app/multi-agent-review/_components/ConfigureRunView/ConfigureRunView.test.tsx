/**
 * ConfigureRunView — the Configure-run form (AC-22 – AC-32).
 *
 * Covers: the PR-gated empty state (AC-24); the spec's worked aggregate example
 * and its all-absent counterpart (AC-30, AC-31); a history-less agent's card
 * (AC-27); an agent with no review summary (AC-28); the conditional launch
 * label and the Select all / Clear all toggle (AC-25); the aggregate appearing
 * only once a PR AND an agent are chosen (AC-30); that a `stale` PR is listed
 * and selectable (AC-23 — the design's `status !== "stale"` filter must not be
 * copied); and that this surface never consults the latest-multi-run resolver
 * (AC-22c).
 *
 * `fireEvent`, not `userEvent` — this project does not install user-event
 * (client/INSIGHTS.md, 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunEstimate, PrMeta } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";

const mockUsePulls = vi.fn();
const mockUseAgents = vi.fn();
const mockUseAgentEstimates = vi.fn();
const mockUseLatestMultiRun = vi.fn();
const mockMutate = vi.fn();
const mockPush = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1", activeRepo: null, repos: [], reposLoaded: true }),
}));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => mockUsePulls() }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => mockUseAgents() }));
vi.mock("@/lib/hooks/multi-runs", () => ({
  useAgentEstimates: () => mockUseAgentEstimates(),
  useLatestMultiRun: (...args: unknown[]) => mockUseLatestMultiRun(...args),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutate: mockMutate, isPending: false }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePr(over: Partial<PrMeta> & { number: number }): PrMeta {
  return {
    id: `pr-${over.number}`,
    title: "a pull request",
    author: "igor",
    branch: "feat/x",
    base: "main",
    head_sha: "abc",
    additions: 1,
    deletions: 0,
    files_count: 1,
    status: "open",
    ...over,
  } as PrMeta;
}

function makeAgent(id: string, name: string, enabled = true): Agent {
  return {
    id,
    name,
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "",
    enabled,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
  } as Agent;
}

function makeEstimate(over: Partial<AgentRunEstimate> & { agent_id: string }): AgentRunEstimate {
  return {
    agent_name: over.agent_id,
    avg_duration_ms: null,
    avg_cost_usd: null,
    duration_sample_count: 0,
    cost_sample_count: 0,
    last_summary: null,
    ...over,
  };
}

function setup({
  pulls = [makePr({ number: 1, title: "add notes search", status: "stale" })],
  agents = [makeAgent("a1", "Security Reviewer")],
  estimates = [] as AgentRunEstimate[],
} = {}) {
  mockUsePulls.mockReturnValue({ data: pulls });
  mockUseAgents.mockReturnValue({ data: agents });
  mockUseAgentEstimates.mockReturnValue({ data: estimates });
  mockUseLatestMultiRun.mockReturnValue({ data: { multi_run: null }, isLoading: false });
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ConfigureRunView />
    </NextIntlClientProvider>,
  );
}

/** Open the Step 1 dropdown and choose the PR labelled `#<number> · <title>`. */
function choosePr(label: string) {
  fireEvent.click(screen.getByText("Select a pull request…"));
  fireEvent.click(screen.getByText(label));
}

describe("ConfigureRunView", () => {
  it("gates step 2 behind a PR with the dashed empty state (AC-24)", () => {
    setup();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(
      screen.getByText("Choose which PR to review above, then select the agents to run on it."),
    ).toBeInTheDocument();
    // No agent cards, no Select all link, no aggregate until a PR is chosen.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Select all")).not.toBeInTheDocument();
    expect(screen.queryByText(/parallel fan-out/)).not.toBeInTheDocument();
  });

  it("lists a `stale` PR and lets it be selected (AC-23 — no status filter)", () => {
    setup();
    choosePr("#1 · add notes search");
    // Step 1 collapses to the chosen PR, step 2 opens up.
    expect(screen.getByText("#1 · add notes search")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Security Reviewer" })).toBeInTheDocument();
  });

  it("renders the spec's worked aggregate example (AC-30)", () => {
    setup({
      agents: [
        makeAgent("a1", "Security"),
        makeAgent("a2", "Performance"),
        makeAgent("a3", "Junior Mentor"),
        makeAgent("a4", "Customer-Facing"),
      ],
      estimates: [
        makeEstimate({ agent_id: "a1", avg_duration_ms: 8200, avg_cost_usd: 0.06 }),
        makeEstimate({ agent_id: "a2", avg_duration_ms: 6000, avg_cost_usd: 0.05 }),
        makeEstimate({ agent_id: "a3", avg_duration_ms: 4100, avg_cost_usd: 0.04 }),
        makeEstimate({ agent_id: "a4", avg_duration_ms: 5000, avg_cost_usd: 0.05 }),
      ],
    });
    choosePr("#1 · add notes search");
    fireEvent.click(screen.getByText("Select all"));

    expect(screen.getByText("≈ 8.2s · $0.20 · parallel fan-out")).toBeInTheDocument();
  });

  it("renders `—` for both metrics when no selected agent has an estimate (AC-31, AC-27)", () => {
    setup({ agents: [makeAgent("a1", "Fresh Agent")], estimates: [] });
    choosePr("#1 · add notes search");
    fireEvent.click(screen.getByRole("checkbox", { name: "Fresh Agent" }));

    expect(screen.getByText("≈ — · — · parallel fan-out")).toBeInTheDocument();
    // AC-27: the card itself shows "—", never "0s"/"$0.00".
    expect(screen.getByText("— · —")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("renders no summary line for an agent that never produced a review (AC-28)", () => {
    setup({
      agents: [makeAgent("a1", "Security"), makeAgent("a2", "Performance")],
      estimates: [
        makeEstimate({ agent_id: "a1", last_summary: "Two critical exposures. Block." }),
        makeEstimate({ agent_id: "a2", last_summary: null }),
      ],
    });
    choosePr("#1 · add notes search");

    expect(screen.getByText("Two critical exposures. Block.")).toBeInTheDocument();
    const performanceCard = screen.getByRole("checkbox", { name: "Performance" });
    // Name + the metric line only — no third, placeholder line.
    expect(performanceCard.textContent).toBe("Performance— · —");
  });

  it("flips the launch label with the count and disables it at zero (AC-25, AC-30 button)", () => {
    setup({ agents: [makeAgent("a1", "Security"), makeAgent("a2", "Performance")] });
    choosePr("#1 · add notes search");

    expect(screen.getByRole("button", { name: "Select agents" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(screen.getByRole("button", { name: "Run 1 agent" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeEnabled();
  });

  it("toggles the Select all link to Clear all and back (AC-25)", () => {
    setup({ agents: [makeAgent("a1", "Security"), makeAgent("a2", "Performance")] });
    choosePr("#1 · add notes search");

    fireEvent.click(screen.getByText("Select all"));
    expect(screen.getByText("Clear all")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear all"));
    expect(screen.getByText("Select all")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select agents" })).toBeDisabled();
  });

  it("launches with the chosen agent ids and never consults the latest-multi-run resolver (AC-22c, AC-32)", () => {
    setup({ agents: [makeAgent("a1", "Security")] });
    choosePr("#1 · add notes search");
    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("button", { name: "Run 1 agent" }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]![0]).toEqual({ prId: "pr-1", agentIds: ["a1"] });
    expect(mockUseLatestMultiRun).not.toHaveBeenCalled();
  });
});
