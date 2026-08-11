/**
 * MultiRunView — the result shell + Columns mode (AC-32 – AC-40, AC-52, AC-53).
 *
 * Covers: four columns in document order with distinct positional accents and a
 * neutral fifth (AC-34, AC-52); per-column `View trace` + `N findings` footers
 * (AC-36); a completed zero-finding lane (edge case); `View trace` on the THIRD
 * column mounting the shared `@/components/RunTraceDrawer` scoped to that
 * lane's run id (AC-39, AC-40); exactly one control back to configuration,
 * targeting the explicit `/multi-agent-review/configure` address (AC-33a); the
 * sub-row reading `parallel fan-out`, not the design's stale "worktrees"
 * wording (AC-33); the disagreement block present in BOTH modes (AC-53); and a
 * 404 rendering a not-found state (AC-64).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, MultiRunAgent, MultiRunDocument } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../messages/en/multiAgent.json";

const mockUseMultiRun = vi.fn();
const mockPush = vi.fn();
const mockTraceProps = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));
vi.mock("@/components/RunTraceDrawer", () => ({
  default: (props: { runId: string }) => {
    mockTraceProps(props);
    return <div data-testid="run-trace-drawer">{props.runId}</div>;
  },
}));
vi.mock("@/lib/hooks/multi-runs", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/multi-runs")>()),
  useMultiRun: (...args: unknown[]) => mockUseMultiRun(...args),
}));
// Tabs mode mounts finding cards, which reach for these two hooks.
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MultiRunView } from "./MultiRunView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeFinding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "a finding",
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 28,
    rationale: "because",
    suggestion: null,
    confidence: 0.8,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function makeAgent(over: Partial<MultiRunAgent> & { run_id: string; agent_name: string }): MultiRunAgent {
  return {
    agent_id: over.run_id.replace("run", "agent"),
    status: "done",
    duration_ms: 8200,
    cost_usd: 0.06,
    score: 38,
    summary: "a summary",
    findings: [],
    ...over,
  } as MultiRunAgent;
}

function makeDoc(over: Partial<MultiRunDocument> = {}): MultiRunDocument {
  return {
    id: "mr-1",
    ran_at: "2026-08-02T10:00:00.000Z",
    pr: { id: "pr-1", number: 1, title: "add notes search" },
    agents: [
      makeAgent({ run_id: "run-1", agent_name: "Security", findings: [makeFinding({ id: "f1" })] }),
      makeAgent({ run_id: "run-2", agent_name: "Performance", findings: [] }),
      makeAgent({
        run_id: "run-3",
        agent_name: "Junior Mentor",
        findings: [makeFinding({ id: "f2" }), makeFinding({ id: "f3" })],
      }),
      makeAgent({ run_id: "run-4", agent_name: "Customer-Facing", findings: [makeFinding({ id: "f4" })] }),
    ],
    groups: [],
    totals: { max_duration_ms: 8200, total_cost_usd: 0.22, agent_count: 4 },
    ...over,
  };
}

function renderView(
  state: { data?: MultiRunDocument; isLoading?: boolean; isError?: boolean; error?: unknown } = {},
) {
  mockUseMultiRun.mockReturnValue({
    data: state.data ?? makeDoc(),
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  });
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <MultiRunView multiRunId="mr-1" />
    </NextIntlClientProvider>,
  );
}

/** The accent-topped column header carries the only 2px top border on the page. */
function laneAccents(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("div"))
    .filter((d) => d.style.borderTopWidth === "2px")
    .map((d) => d.style.borderTopColor);
}

describe("MultiRunView — Columns mode", () => {
  it("renders one accent-topped column per agent in document order (AC-34, AC-52)", () => {
    const { container } = renderView();

    const names = ["Security", "Performance", "Junior Mentor", "Customer-Facing"];
    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();

    const accents = laneAccents(container);
    expect(accents).toHaveLength(4);
    expect(new Set(accents).size).toBe(4); // positional, never repeated
  });

  it("falls a fifth lane through to the neutral slot (AC-52)", () => {
    const doc = makeDoc();
    doc.agents.push(makeAgent({ run_id: "run-5", agent_name: "Architecture" }));
    const { container } = renderView({ data: doc });

    const accents = laneAccents(container);
    expect(accents).toHaveLength(5);
    expect(accents[4]).toContain("var(--text-muted)");
  });

  it("renders a View trace link and the finding count in every footer (AC-36)", () => {
    renderView();
    expect(screen.getAllByRole("button", { name: "View trace" })).toHaveLength(4);
    expect(screen.getAllByText("1 finding")).toHaveLength(2);
    expect(screen.getByText("2 findings")).toBeInTheDocument();
  });

  it("renders an empty findings area and `0 findings` for a completed zero-finding lane (edge case)", () => {
    renderView();
    expect(screen.getByText("0 findings")).toBeInTheDocument();
    expect(screen.getByText("No findings.")).toBeInTheDocument();
  });

  it("opens the shared trace drawer scoped to the requesting lane (AC-39, AC-40)", () => {
    renderView();
    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "View trace" })[2]!);

    expect(screen.getByTestId("run-trace-drawer")).toHaveTextContent("run-3");
    expect(mockTraceProps).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-3", agentName: "Junior Mentor", prNumber: 1, running: false }),
    );
  });

  it("streams the live log for a lane that is still running (AC-41)", () => {
    const doc = makeDoc();
    doc.agents[0]!.status = "running";
    renderView({ data: doc });

    fireEvent.click(screen.getAllByRole("button", { name: "View trace" })[0]!);
    expect(mockTraceProps).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", running: true }));
  });
});

describe("MultiRunView — shell", () => {
  it("offers exactly one route back to configuration, at the explicit address (AC-33a)", () => {
    renderView();
    const controls = screen.getAllByText("Configure run");
    expect(controls).toHaveLength(1);

    fireEvent.click(controls[0]!);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/multi-agent-review/configure");
  });

  it("reads `parallel fan-out` in the sub-row, never the design's stale worktrees wording (AC-33)", () => {
    renderView();
    expect(screen.getByText("4 agents · parallel fan-out · 8.2s · $0.22")).toBeInTheDocument();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
    expect(screen.getByText("4 selected agents · parallel")).toBeInTheDocument();
  });

  it("renders the disagreement block in BOTH modes (AC-53)", () => {
    renderView();
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    // The segmented control exposes its selected state programmatically (R12).
    expect(screen.getByRole("button", { name: "Tabs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders a not-found state for an unresolvable multi-run id (AC-64)", () => {
    renderView({ data: undefined, isError: true, error: new ApiError("nope", 404) });
    expect(screen.getByText("Multi-agent run not found")).toBeInTheDocument();
  });
});
