/**
 * EvalAgentDrillIn — per-agent Eval Dashboard drill-in (AC-33–AC-35).
 * Covers: tiles + chart + recent-runs table render with a ≥3-batch dashboard
 * fixture; the alert banner is ABSENT when `dashboard.alert` is null and
 * renders the exact string verbatim when present; selecting a 3rd checkbox
 * drops the 1st (oldest) selection, keeping exactly 2 selected; "Compare
 * runs" is disabled at 0/1 selections and enabled at exactly 2.
 *
 * Mocks live at the hook boundary (mirrors EvalDashboardIndex.test.tsx /
 * EvalCaseEditor.test.tsx). `fireEvent`, not `userEvent`, per this project's
 * convention (client/INSIGHTS.md, 2026-07-12). The `@devdigest/ui` Checkbox
 * has no accessible name unless a `label` prop is passed, so rows are
 * selected by `getAllByRole("checkbox")` DOM order (client/INSIGHTS.md,
 * 2026-07-18).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalTrendPoint } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";

const mockUseAgentEvalDashboard = vi.fn();
const mockUseAgent = vi.fn();
const mockRunMutate = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalDashboard: (...args: unknown[]) => mockUseAgentEvalDashboard(...args),
  useRunEvalBatch: () => ({ mutate: mockRunMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
}));

import { EvalAgentDrillIn } from "./EvalAgentDrillIn";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDrillIn() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalAgentDrillIn agentId="agent-1" />
    </NextIntlClientProvider>,
  );
}

function point(over: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    run_id: "b1",
    agent_version: 1,
    ran_at: "2026-07-01T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    pass_rate: 0.8,
    cost_usd: 0.01,
    ...over,
  };
}

function makeDashboard(over: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 20,
    current: {
      recall: 0.92,
      precision: 0.95,
      citation_accuracy: 1,
      traces_passed: 18,
      traces_total: 20,
      cost_usd: 0.5,
    },
    delta: { recall: 0.05, precision: -0.02, citation_accuracy: 0 },
    trend: [
      point({ run_id: "b1", agent_version: 5, ran_at: "2026-07-01T00:00:00.000Z", recall: 0.7 }),
      point({ run_id: "b2", agent_version: 6, ran_at: "2026-07-10T00:00:00.000Z", recall: 0.8 }),
      point({ run_id: "b3", agent_version: 7, ran_at: "2026-07-20T00:00:00.000Z", recall: 0.9 }),
    ],
    recent_runs: [
      point({ run_id: "b3", agent_version: 7, ran_at: "2026-07-20T00:00:00.000Z", recall: 0.9 }),
      point({ run_id: "b2", agent_version: 6, ran_at: "2026-07-10T00:00:00.000Z", recall: 0.8 }),
      point({ run_id: "b1", agent_version: 5, ran_at: "2026-07-01T00:00:00.000Z", recall: 0.7 }),
    ],
    alert: null,
    ...over,
  };
}

function mockDashboardData(dashboard: EvalDashboard) {
  mockUseAgentEvalDashboard.mockReturnValue({
    data: dashboard,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe("EvalAgentDrillIn", () => {
  it("renders tiles, chart, and the recent-runs table for a ≥3-batch dashboard", () => {
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard());

    renderDrillIn();

    expect(screen.getByText(/Security Reviewer/)).toBeInTheDocument();
    expect(screen.getByText(/gpt-4\.1/)).toBeInTheDocument();
    // Tiles: current recall/precision/citation.
    expect(screen.getByText("92%")).toBeInTheDocument(); // current recall
    expect(screen.getByText("95%")).toBeInTheDocument(); // current precision
    // Recent runs table: 3 version tags.
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("v6")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
    // 3 checkboxes, one per row.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("renders no alert banner when dashboard.alert is null", () => {
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard({ alert: null }));

    renderDrillIn();

    expect(screen.queryByText(/dipped|slipped|notable/i)).not.toBeInTheDocument();
  });

  it("renders the exact alert string verbatim when present", () => {
    const ALERT =
      "Precision dipped 2pts on v7 — a new false positive slipped in. Recall and citation both up.";
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard({ alert: ALERT }));

    renderDrillIn();

    expect(screen.getByText(ALERT)).toBeInTheDocument();
  });

  it("selecting a 3rd checkbox drops the 1st (oldest) selection, keeping exactly 2 selected", () => {
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard());

    renderDrillIn();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);

    fireEvent.click(boxes[0]!); // select b3 (row order matches recent_runs: b3,b2,b1)
    fireEvent.click(boxes[1]!); // select b2 -> [b3, b2]
    expect(boxes[0]).toHaveAttribute("aria-checked", "true");
    expect(boxes[1]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(boxes[2]!); // select b1 (3rd) -> drops oldest-selected (b3) -> [b2, b1]
    expect(boxes[0]).toHaveAttribute("aria-checked", "false");
    expect(boxes[1]).toHaveAttribute("aria-checked", "true");
    expect(boxes[2]).toHaveAttribute("aria-checked", "true");
  });

  it('"Compare runs" is disabled at 0/1 selections and enabled at exactly 2', () => {
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard());

    renderDrillIn();

    const compareButton = screen.getByRole("button", { name: "Compare runs" });
    expect(compareButton).toBeDisabled();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(compareButton).toBeDisabled(); // 1 selected

    fireEvent.click(boxes[1]!);
    expect(compareButton).not.toBeDisabled(); // exactly 2 selected

    fireEvent.click(boxes[1]!); // deselect back to 1
    expect(compareButton).toBeDisabled();
  });

  it("renders a neutral empty state, not the table, when there are zero run batches", () => {
    mockUseAgent.mockReturnValue({ data: { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } });
    mockDashboardData(makeDashboard({ trend: [], recent_runs: [], alert: null }));

    renderDrillIn();

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getAllByText("No runs yet. Create an eval case and run it.").length).toBeGreaterThan(0);
  });
});
