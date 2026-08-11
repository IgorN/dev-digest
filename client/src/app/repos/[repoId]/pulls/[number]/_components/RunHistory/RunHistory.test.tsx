/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, LatestMultiRunRef } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

function renderRuns(
  runs: RunSummary[],
  extra: {
    latestMultiRun?: LatestMultiRunRef | null;
    onOpenMultiRun?: (id: string) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, multiAgent }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} {...extra} />
    </NextIntlClientProvider>,
  );
}

function multiRun(o: Partial<LatestMultiRunRef> = {}): LatestMultiRunRef {
  return {
    id: "mr-newest",
    pr_id: "pr1",
    pr_number: 1,
    pr_title: "feat(notes): add notes search and create",
    ran_at: "2026-06-11T19:10:00.000Z",
    ...o,
  };
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — multi-agent re-entry (AC-21a/AC-21b)", () => {
  it("a PR with NO prior multi-run renders no re-entry entry", () => {
    renderRuns([run({})]);
    expect(screen.queryByRole("button", { name: "Open multi-agent result" })).not.toBeInTheDocument();
  });

  it("a PR with a prior multi-run renders the entry and activating it navigates only", () => {
    const onOpenMultiRun = vi.fn();
    renderRuns([run({})], { latestMultiRun: multiRun(), onOpenMultiRun });

    const entry = screen.getByRole("button", { name: "Open multi-agent result" });
    expect(screen.getByText("Multi-agent review")).toBeInTheDocument();

    fireEvent.click(entry);
    // Pure navigation: exactly the id the server returned as latest, and no
    // launch of any kind (the component owns no mutation at all).
    expect(onOpenMultiRun).toHaveBeenCalledTimes(1);
    expect(onOpenMultiRun).toHaveBeenCalledWith("mr-newest");
  });

  it("targets exactly the server-resolved id — the client re-orders nothing", () => {
    const onOpenMultiRun = vi.fn();
    // `ran_at` older than the run in the list: the entry still targets it,
    // because "newest" was decided server-side by the multi-run's own stamp.
    renderRuns([run({ ran_at: "2026-06-11T23:00:00.000Z" })], {
      latestMultiRun: multiRun({ id: "mr-server-picked", ran_at: "2026-06-11T01:00:00.000Z" }),
      onOpenMultiRun,
    });
    fireEvent.click(screen.getByRole("button", { name: "Open multi-agent result" }));
    expect(onOpenMultiRun).toHaveBeenCalledWith("mr-server-picked");
  });

  it("renders the entry even when the PR has no runs and no commits at all", () => {
    renderRuns([], { latestMultiRun: multiRun(), onOpenMultiRun: vi.fn() });
    expect(screen.getByRole("button", { name: "Open multi-agent result" })).toBeInTheDocument();
  });
});
