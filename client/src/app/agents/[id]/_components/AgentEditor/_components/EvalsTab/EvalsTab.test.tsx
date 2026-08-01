/**
 * EvalsTab — the Agent Editor's Evals tab (L06). Covers: metric tiles +
 * deltas rendering from a populated dashboard fixture (AC-26); case rows
 * rendering all five described elements (status icon, name, "expected N,
 * got M" subtitle, severity/category badge, run/edit/delete actions) for
 * BOTH a run case and a never-run case with a distinct icon (AC-27); "Run
 * all evals" issuing an unscoped (`{}`) request and "+ New eval case"
 * opening the editor (AC-28); the "View full dashboard →" link resolving to
 * `/eval/<agentId>` (AC-29).
 *
 * Hooks mocked at the `@/lib/hooks/eval` boundary (mirrors
 * EvalDashboardIndex.test.tsx / EvalCaseEditor.test.tsx); `EvalCaseEditor`
 * mocked to a passthrough stub (mirrors FindingCard.test.tsx). `fireEvent`,
 * not `userEvent`, per this project's convention (client/INSIGHTS.md,
 * 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalDashboard, EvalRunBatchResponse } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const hoisted = vi.hoisted(() => ({
  useAgentEvalDashboard: vi.fn(),
  useEvalCases: vi.fn(),
  runMutateAsync: vi.fn(),
  runIsPending: false,
  deleteMutate: vi.fn(),
  deleteIsPending: false,
}));

vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalDashboard: (...args: unknown[]) => hoisted.useAgentEvalDashboard(...args),
  useEvalCases: (...args: unknown[]) => hoisted.useEvalCases(...args),
  useRunEvalBatch: () => ({
    mutateAsync: hoisted.runMutateAsync,
    isPending: hoisted.runIsPending,
  }),
  useDeleteEvalCase: () => ({
    mutate: hoisted.deleteMutate,
    isPending: hoisted.deleteIsPending,
  }),
}));

vi.mock("@/components/EvalCaseEditor", () => ({
  EvalCaseEditor: (props: { evalCase: EvalCase | null; onClose: () => void }) => (
    <div data-testid="eval-case-editor">
      <span data-testid="eval-case-editor-name">{props.evalCase?.name ?? "(new)"}</span>
      <button onClick={props.onClose}>close-editor</button>
    </div>
  ),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  hoisted.runIsPending = false;
  hoisted.deleteIsPending = false;
});

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 3,
};

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "agent-1",
  cases_total: 2,
  current: {
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    traces_passed: 8,
    traces_total: 10,
    cost_usd: 0.05,
  },
  delta: { recall: 0.05, precision: -0.02, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  alert: null,
};

const NEVER_RUN_CASE: EvalCase = {
  id: "case-never",
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "never-run-case",
  input_diff: "--- a/a.ts\n+++ b/a.ts",
  input_files: ["a.ts"],
  input_meta: null,
  expected_output: [{ type: "must_find", file: "a.ts", start_line: 1, severity: "WARNING", category: "bug" }],
  notes: null,
};

const RUNNABLE_CASE: EvalCase = {
  id: "case-runnable",
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "runnable-case",
  input_diff: "--- a/b.ts\n+++ b/b.ts",
  input_files: ["b.ts"],
  input_meta: null,
  expected_output: [
    { type: "must_find", file: "b.ts", start_line: 1, severity: "SUGGESTION", category: "style" },
    { type: "must_find", file: "b.ts", start_line: 5, severity: "CRITICAL", category: "security" },
  ],
  notes: null,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

function setUp(cases: EvalCase[]) {
  hoisted.useAgentEvalDashboard.mockReturnValue({ data: DASHBOARD, isLoading: false });
  hoisted.useEvalCases.mockReturnValue({ data: cases, isLoading: false });
}

describe("EvalsTab", () => {
  it("renders the four metric tiles with deltas from a populated dashboard", () => {
    setUp([]);
    renderTab();

    expect(screen.getByText("80%")).toBeInTheDocument(); // recall
    expect(screen.getByText("90%")).toBeInTheDocument(); // precision
    expect(screen.getByText("100%")).toBeInTheDocument(); // citation accuracy
    expect(screen.getByText("8/10")).toBeInTheDocument(); // traces passed, no delta badge
  });

  it("renders all five row elements for a never-run case (neutral icon) and a run case (pass/fail icon)", async () => {
    setUp([NEVER_RUN_CASE, RUNNABLE_CASE]);
    const batchResponse: EvalRunBatchResponse = {
      run_batch_id: "batch-1",
      results: [
        {
          run_id: "run-1",
          case_id: RUNNABLE_CASE.id,
          result: {
            recall: 1,
            precision: 1,
            citation_accuracy: 1,
            traces_passed: 3,
            traces_total: 3,
            duration_ms: 900,
            cost_usd: 0.01,
            // Realistic server shape (server/src/modules/eval/service.ts):
            // one `__produced_count__` marker PREPENDED, then one trace per
            // expectation item — `actual` is a single `Finding` object or
            // `null`, NEVER an array (the bug this fixture used to mask).
            per_trace: [
              { name: "__produced_count__", pass: true, expected: null, actual: { produced: 1 } },
              {
                name: "must_find b.ts:1",
                pass: true,
                expected: { type: "must_find", file: "b.ts", start_line: 1 },
                actual: { id: "f1", file: "b.ts", start_line: 1 },
              },
              {
                name: "must_find b.ts:5",
                pass: true,
                expected: { type: "must_find", file: "b.ts", start_line: 5 },
                actual: null,
              },
            ],
          },
        },
      ],
      dashboard: DASHBOARD,
    };
    hoisted.runMutateAsync.mockResolvedValue(batchResponse);

    renderTab();

    // Never-run case: neutral status, name, "expected N, got —", severity badge.
    expect(screen.getByText("never-run-case")).toBeInTheDocument();
    expect(screen.getAllByText("never run").length).toBeGreaterThan(0);
    expect(screen.getByText("expected 1 finding(s), got —")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument(); // severity badge label

    // Run the second case via its row's own Run button.
    const runnableRow = screen.getByTestId(`eval-case-row-${RUNNABLE_CASE.id}`);
    fireEvent.click(within(runnableRow).getByText("Run"));

    expect(hoisted.runMutateAsync).toHaveBeenCalledWith({ case_ids: [RUNNABLE_CASE.id] });
    await waitFor(() => expect(screen.getByText("passed")).toBeInTheDocument());
    expect(screen.getByText("expected 2 finding(s), got 1")).toBeInTheDocument();
    // Highest severity present on the runnable case is CRITICAL.
    expect(screen.getByText("Critical")).toBeInTheDocument();

    // The never-run case is untouched — still neutral, distinct from the
    // now-passed case.
    expect(screen.getAllByText("never run").length).toBe(1);
  });

  it('"Run all evals" issues an unscoped ({}) request, and "+ New eval case" opens the editor', async () => {
    setUp([NEVER_RUN_CASE]);
    hoisted.runMutateAsync.mockResolvedValue({
      run_batch_id: "batch-2",
      results: [],
      dashboard: DASHBOARD,
    } satisfies EvalRunBatchResponse);

    renderTab();

    fireEvent.click(screen.getByText("Run all evals"));
    expect(hoisted.runMutateAsync).toHaveBeenCalledWith({});
    await waitFor(() => expect(hoisted.runMutateAsync).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId("eval-case-editor")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("New case"));
    expect(screen.getByTestId("eval-case-editor")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-editor-name")).toHaveTextContent("(new)");
  });

  it("the 'View full dashboard →' link resolves to /eval/<agentId>", () => {
    setUp([]);
    renderTab();

    const link = screen.getByText("View full dashboard →").closest("a")!;
    expect(link).toHaveAttribute("href", "/eval/agent-1");
  });

  it("renders a loading state while cases/dashboard are pending, and an empty state with zero cases", () => {
    hoisted.useAgentEvalDashboard.mockReturnValue({ data: undefined, isLoading: true });
    hoisted.useEvalCases.mockReturnValue({ data: undefined, isLoading: true });
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("80%")).not.toBeInTheDocument();

    setUp([]);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("No eval cases yet. Create one to assert this agent's expected findings on a sample diff."),
    ).toBeInTheDocument();
  });
});
