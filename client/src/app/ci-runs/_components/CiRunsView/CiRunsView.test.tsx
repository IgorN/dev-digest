/**
 * CiRunsView — the /ci-runs leaf.
 *
 * Covers AC-45 – AC-53: the heading/sub-line copy (with a hard assertion that
 * next-intl emitted NO missing-message error), the design's nine columns in
 * order, `#<number>` with no fabricated title, the never-`0` findings cell, all
 * four status states distinguishable by TEXT, the new-tab job link, the five
 * filter chips, the Refresh in-progress + honest-outcome states, and the empty
 * state instead of a bare table shell.
 *
 * Mocks live at the hook / app-shell boundary (the OnboardingView.test.tsx /
 * EvalDashboardIndex.test.tsx harness). `fireEvent`, not `userEvent` —
 * @testing-library/user-event is not installed (client/INSIGHTS.md 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiIngestResult, CiRun, CiRunsResponse } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

const mockUseCiRuns = vi.fn();
const mockRefreshMutate = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("@/lib/hooks/ci-runs", () => ({
  useCiRuns: (...args: unknown[]) => mockUseCiRuns(...args),
  useRefreshCiRuns: () => mockRefresh(),
}));

import { CiRunsView } from "./CiRunsView";

const intlErrors: unknown[] = [];

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci: ciMessages }}
      onError={(e) => intlErrors.push(e)}
    >
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

function makeRun(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "r1",
    ci_installation_id: "i1",
    workspace_id: "w1",
    agent_run_id: "ar1",
    github_run_id: "9001",
    repo: "acme/payments-api",
    pr_number: 482,
    pr_title: "Add rate limiting to public API endpoints",
    ran_at: "2026-06-01T08:42:00.000Z",
    status: "succeeded",
    findings_count: 3,
    critical: 2,
    warning: 0,
    suggestion: 1,
    cost_usd: 0.07,
    github_url: "https://github.com/acme/payments-api/actions/runs/9001",
    source: "GitHub Actions",
    agent: "Security Reviewer",
    duration_s: 7.4,
    ...over,
  };
}

function makeResponse(over: Partial<CiRunsResponse> = {}): CiRunsResponse {
  return {
    runs: [makeRun()],
    agents: [{ id: "a1", name: "Security Reviewer" }],
    repos: ["acme/payments-api"],
    ...over,
  };
}

function makeIngest(over: Partial<CiIngestResult> = {}): CiIngestResult {
  return { examined: 0, ingested: 0, skipped: 0, already_known: 0, failures: [], ...over };
}

type RefreshState = {
  mutate?: () => void;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  data?: CiIngestResult | undefined;
};

function setup(response: CiRunsResponse | null, refresh: RefreshState = {}) {
  mockUseCiRuns.mockReturnValue({
    data: response ?? undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockRefresh.mockReturnValue({
    mutate: mockRefreshMutate,
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    ...refresh,
  });
}

beforeEach(() => {
  intlErrors.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CiRunsView — header and columns", () => {
  it("renders the heading and sub-line from ci.runs.* with no missing-message error (AC-45)", () => {
    setup(makeResponse());
    renderView();

    expect(screen.getByRole("heading", { name: "CI Runs" })).toBeInTheDocument();
    expect(
      screen.getByText("Agent reviews executed inside CI · not local runs"),
    ).toBeInTheDocument();
    expect(screen.getByText("auto-refresh on")).toBeInTheDocument();
    expect(intlErrors).toEqual([]);
  });

  it("renders the design's nine columns in the design's order (AC-46)", () => {
    setup(makeResponse());
    renderView();

    const header = screen.getByTestId("ci-runs-header");
    const labels = Array.from(header.children).map((c) => c.textContent);
    expect(labels).toEqual([
      "Timestamp",
      "Pull request",
      "Agent",
      "Source",
      "Dur.",
      "Findings",
      "Cost",
      "Status",
      "",
    ]);
  });
});

describe("CiRunsView — row cells", () => {
  it("renders #<number> alone when no PR title is known — no fabricated title (AC-47)", () => {
    setup(makeResponse({ runs: [makeRun({ id: "r9", pr_number: 471, pr_title: null })] }));
    renderView();

    const row = screen.getByTestId("ci-run-row-r9");
    expect(within(row).getByText("#471")).toBeInTheDocument();
    // The accessible name falls back to the number, and the cell carries the
    // number and NOTHING else — no placeholder/fabricated title text.
    const prCell = within(row).getByLabelText("Pull request #471");
    expect(prCell.textContent).toBe("#471");
  });

  it("renders one pair per non-zero severity and — (never 0) when all are zero (AC-48)", () => {
    setup(
      makeResponse({
        runs: [
          makeRun({ id: "rA", critical: 2, warning: 0, suggestion: 1 }),
          makeRun({ id: "rB", critical: 0, warning: 0, suggestion: 0, cost_usd: null, duration_s: null }),
        ],
      }),
    );
    renderView();

    const withFindings = screen.getByTestId("ci-run-row-rA");
    expect(within(withFindings).getByText("2")).toBeInTheDocument();
    expect(within(withFindings).getByText("1")).toBeInTheDocument();
    expect(within(withFindings).getByTitle("Critical")).toBeInTheDocument();
    expect(within(withFindings).getByTitle("Suggestion")).toBeInTheDocument();
    // WARNING is zero — no pair for it.
    expect(within(withFindings).queryByTitle("Warning")).not.toBeInTheDocument();

    const zero = screen.getByTestId("ci-run-row-rB");
    expect(within(zero).queryByText("0")).not.toBeInTheDocument();
    // findings, cost and duration all unknown/zero → em dashes, never "0"/"$0.00".
    expect(within(zero).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(zero).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("renders all four status states with distinct text, not colour alone (AC-49)", () => {
    setup(
      makeResponse({
        runs: [
          makeRun({ id: "s1", status: "succeeded" }),
          makeRun({ id: "s2", status: "no_findings" }),
          makeRun({ id: "s3", status: "failed" }),
          makeRun({ id: "s4", status: "running" }),
        ],
      }),
    );
    renderView();

    expect(within(screen.getByTestId("ci-run-row-s1")).getByText("Succeeded")).toBeInTheDocument();
    expect(within(screen.getByTestId("ci-run-row-s2")).getByText("No findings")).toBeInTheDocument();
    expect(within(screen.getByTestId("ci-run-row-s3")).getByText("Failed")).toBeInTheDocument();
    expect(within(screen.getByTestId("ci-run-row-s4")).getByText("Running")).toBeInTheDocument();
  });

  it("links the trailing cell to the persisted GitHub Actions job in a new tab (AC-50)", () => {
    setup(makeResponse());
    renderView();

    const link = screen.getByRole("link", { name: "View job" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/9001",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("CiRunsView — filters", () => {
  it("renders the five filter chips, populated from the response facets (AC-51)", () => {
    setup(makeResponse());
    renderView();

    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("All agents")).toBeInTheDocument();
    expect(screen.getByText("All repos")).toBeInTheDocument();
    expect(screen.getByText("All statuses")).toBeInTheDocument();
    expect(screen.getByText("All sources")).toBeInTheDocument();
  });

  it("applies a chip selection to the query", () => {
    setup(makeResponse());
    renderView();

    fireEvent.click(screen.getByText("Last 7 days"));
    expect(mockUseCiRuns).toHaveBeenLastCalledWith({ days: 7 });
  });

  it("offers the agent/repo options the SAME response carried, and applies one (AC-51)", () => {
    setup(makeResponse());
    renderView();

    // The agent chip's menu is filled from CiRunsResponse.agents — no second request.
    fireEvent.click(screen.getByText("All agents"));
    fireEvent.click(screen.getByText("Security Reviewer", { selector: "button span" }));
    expect(mockUseCiRuns).toHaveBeenLastCalledWith({ agent_id: "a1" });

    fireEvent.click(screen.getByText("All repos"));
    fireEvent.click(screen.getByText("acme/payments-api", { selector: "button span" }));
    expect(mockUseCiRuns).toHaveBeenLastCalledWith({ agent_id: "a1", repo: "acme/payments-api" });
  });
});

describe("CiRunsView — refresh", () => {
  it("fires the ingest mutation and shows the in-progress state (AC-52)", () => {
    setup(makeResponse());
    renderView();

    fireEvent.click(screen.getByText("Refresh"));
    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);

    cleanup();
    setup(makeResponse(), { isPending: true });
    renderView();
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
  });

  it("reports a fully successful refresh with the ingested/examined counts (AC-52)", () => {
    setup(makeResponse(), { data: makeIngest({ examined: 4, ingested: 4 }) });
    renderView();

    expect(screen.getByText("Ingested 4 of 4 runs")).toBeInTheDocument();
  });

  it("reports a PARTIAL refresh honestly rather than as a flat done (AC-52)", () => {
    setup(makeResponse(), {
      data: makeIngest({
        examined: 4,
        ingested: 3,
        failures: [{ github_run_id: "9002", reason: "artifact not extractable" }],
      }),
    });
    renderView();

    expect(screen.getByText("Ingested 3 of 4; 1 failed")).toBeInTheDocument();
  });
});

describe("CiRunsView — empty states", () => {
  it("with NO filters and zero rows, renders the design's empty state, not an empty table shell (AC-53)", () => {
    setup(makeResponse({ runs: [], agents: [], repos: [] }));
    renderView();

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(
      screen.getByText("Once you export an agent to CI, every automated review shows up here."),
    ).toBeInTheDocument();
    // The two zero-row states must never collapse into one.
    expect(screen.queryByText("No runs match these filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Set up CI for an agent"));
    expect(mockPush).toHaveBeenCalledWith("/agents");
  });

  it("keeps Refresh reachable with zero rows — it is the only way to pull the first run", () => {
    setup(makeResponse({ runs: [], agents: [], repos: [] }));
    renderView();

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    // Without this the page is a deadlock: no rows ⇒ no button ⇒ no rows.
    fireEvent.click(screen.getByText("Refresh"));
    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
  });

  it("with ACTIVE filters and zero rows, renders the filtered-empty copy and a working Clear filters", () => {
    setup(makeResponse());
    renderView();

    // Constrain the list, then have the (mocked) response come back empty.
    fireEvent.click(screen.getByText("Last 7 days"));
    expect(mockUseCiRuns).toHaveBeenLastCalledWith({ days: 7 });
    setup(makeResponse({ runs: [] }));
    fireEvent.click(screen.getByText("All statuses"));
    fireEvent.click(screen.getByText("Failed", { selector: "button span" }));

    expect(screen.getByText("No runs match these filters")).toBeInTheDocument();
    expect(
      screen.getByText("Widen the date range or clear a filter to see more."),
    ).toBeInTheDocument();
    // NOT the "never exported anything" copy — this workspace does have runs.
    expect(screen.queryByText("No CI runs yet")).not.toBeInTheDocument();
    // The header and the chip row stay so the query can actually be widened.
    expect(screen.getByRole("heading", { name: "CI Runs" })).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.queryByTestId("ci-runs-header")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(mockUseCiRuns).toHaveBeenLastCalledWith({});
    expect(intlErrors).toEqual([]);
  });
});
