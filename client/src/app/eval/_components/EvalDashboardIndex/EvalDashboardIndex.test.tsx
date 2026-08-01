/**
 * EvalDashboardIndex — the workspace-wide Eval Dashboard leaf (AC-31/AC-32).
 * Covers: a populated agent renders its sparkline + recall/precision/citation
 * + "last run" line; a zero-batch agent renders the neutral empty state
 * instead of an error or a zeroed chart; and "Run all agents" is present and
 * invokes the mutation on click.
 *
 * Mocks live at the hook / app-shell boundary, matching this codebase's
 * OnboardingView.test.tsx harness (AppShell mocked to a passthrough div,
 * hooks module mocked directly) — fireEvent, not userEvent, per this
 * project's convention (client/INSIGHTS.md, 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalWorkspaceDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";

const mockUseEvalWorkspaceDashboard = vi.fn();
const mockRunAllMutate = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalWorkspaceDashboard: (...args: unknown[]) => mockUseEvalWorkspaceDashboard(...args),
  useRunAllAgentEvals: () => ({ mutate: mockRunAllMutate, isPending: false }),
}));

import { EvalDashboardIndex } from "./EvalDashboardIndex";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderIndex() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardIndex />
    </NextIntlClientProvider>,
  );
}

function makeDashboard(over: Partial<EvalWorkspaceDashboard> = {}): EvalWorkspaceDashboard {
  return {
    agents: [],
    recent_runs: [],
    ...over,
  };
}

describe("EvalDashboardIndex", () => {
  it("renders a populated agent's sparkline, metrics, and last-run line", () => {
    mockUseEvalWorkspaceDashboard.mockReturnValue({
      data: makeDashboard({
        agents: [
          {
            agent_id: "a1",
            agent_name: "Security Reviewer",
            dashboard: {
              owner_kind: "agent",
              owner_id: "a1",
              cases_total: 10,
              current: {
                recall: 0.85,
                precision: 0.9,
                citation_accuracy: 1,
                traces_passed: 17,
                traces_total: 20,
                cost_usd: 0.12,
              },
              delta: { recall: 0.05, precision: 0, citation_accuracy: 0 },
              trend: [
                {
                  run_id: "b1",
                  agent_version: 2,
                  ran_at: "2026-07-20T00:00:00.000Z",
                  recall: 0.8,
                  precision: 0.9,
                  citation_accuracy: 1,
                  pass_rate: 0.8,
                  cost_usd: 0.1,
                },
                {
                  run_id: "b2",
                  agent_version: 3,
                  ran_at: "2026-07-28T00:00:00.000Z",
                  recall: 0.85,
                  precision: 0.9,
                  citation_accuracy: 1,
                  pass_rate: 0.85,
                  cost_usd: 0.12,
                },
              ],
              recent_runs: [
                {
                  run_id: "b2",
                  agent_version: 3,
                  ran_at: "2026-07-28T00:00:00.000Z",
                  recall: 0.85,
                  precision: 0.9,
                  citation_accuracy: 1,
                  pass_rate: 0.85,
                  cost_usd: 0.12,
                },
              ],
              alert: null,
            },
          },
        ],
        recent_runs: [],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderIndex();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument(); // recall
    expect(screen.getByText("90%")).toBeInTheDocument(); // precision
    expect(screen.getByText(/last run v3.*17\/20 pass/)).toBeInTheDocument();
  });

  it("renders the neutral empty state (not an error or zeroed chart) for a zero-batch agent", () => {
    mockUseEvalWorkspaceDashboard.mockReturnValue({
      data: makeDashboard({
        agents: [
          {
            agent_id: "a2",
            agent_name: "Docs Reviewer",
            dashboard: {
              owner_kind: "agent",
              owner_id: "a2",
              cases_total: 4,
              current: {
                recall: 0,
                precision: 0,
                citation_accuracy: 0,
                traces_passed: 0,
                traces_total: 0,
                cost_usd: null,
              },
              delta: { recall: 0, precision: 0, citation_accuracy: 0 },
              trend: [],
              recent_runs: [],
              alert: null,
            },
          },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderIndex();

    expect(screen.getByText("Docs Reviewer")).toBeInTheDocument();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    // no metric percentages rendered for a zero-batch agent — not "0%".
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows 'Run all agents' and invokes the mutation on click", () => {
    mockUseEvalWorkspaceDashboard.mockReturnValue({
      data: makeDashboard(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderIndex();

    fireEvent.click(screen.getByText("Run all agents"));
    expect(mockRunAllMutate).toHaveBeenCalledTimes(1);
  });
});
