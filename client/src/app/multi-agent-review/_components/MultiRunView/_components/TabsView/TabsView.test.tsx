/**
 * TabsView + MultiAgentFindingCard — Tabs mode (AC-46 – AC-51).
 *
 * Covers: one tab per agent with a score badge and the active accent underline
 * (AC-46); the agent summary card with its trace link and duration/cost
 * (AC-47); an expanded card's `SUGGESTED FIX` block present only where the
 * finding carries a suggestion (AC-49); Accept / Dismiss / Turn into eval case
 * routed through the EXISTING hooks and no other request (AC-50); `Learn`
 * present, programmatically disabled, tooltipped, and issuing zero calls, with
 * no `Reply to author` control anywhere (AC-51).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, MultiRunAgent } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";

const mockFindingAction = vi.fn();
const mockCreateEvalCase = vi.fn();
const mockViewTrace = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: mockFindingAction, isPending: false }),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: mockCreateEvalCase, isPending: false }),
}));
vi.mock("@/components/EvalCaseEditor", () => ({
  EvalCaseEditor: () => <div data-testid="eval-case-editor" />,
}));

import { TabsView } from "./TabsView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeFinding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: `finding ${over.id}`,
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 28,
    rationale: "two sequential redis calls per request",
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

const AGENTS: MultiRunAgent[] = [
  makeAgent({
    run_id: "run-1",
    agent_name: "Security",
    findings: [
      makeFinding({ id: "f1", title: "Committed live key", suggestion: "Rotate the key." }),
      makeFinding({ id: "f2", title: "Magic number 3600" }),
    ],
  }),
  makeAgent({ run_id: "run-2", agent_name: "Performance", score: 64, findings: [] }),
];

function renderTabs(agents: MultiRunAgent[] = AGENTS) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <TabsView agents={agents} prId="pr-1" onViewTrace={mockViewTrace} />
    </NextIntlClientProvider>,
  );
}

describe("TabsView", () => {
  it("renders one tab per agent with a score badge and an accent underline (AC-46)", () => {
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[0]!.textContent).toContain("38");
    expect(tabs[1]!.textContent).toContain("64");
    // The active tab's underline is that agent's positional accent, and the
    // inactive one carries none.
    expect(tabs[0]!.style.borderBottomColor).not.toBe("transparent");
    expect(tabs[1]!.style.borderBottomColor).toBe("transparent");

    fireEvent.click(tabs[1]!);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("renders the agent summary card with its trace link and duration/cost (AC-47)", () => {
    renderTabs();
    expect(screen.getByText("a summary")).toBeInTheDocument();
    expect(screen.getByText("8.2s · $0.06")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View trace" }));
    expect(mockViewTrace).toHaveBeenCalledWith("run-1");
  });

  it("shows SUGGESTED FIX only where the finding carries a suggestion (AC-49)", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Committed live key"));
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Magic number 3600"));
    // Still exactly one — the second finding has no suggestion.
    expect(screen.getAllByText("Suggested fix")).toHaveLength(1);
  });

  it("routes Accept, Dismiss and Turn into eval case through the existing hooks (AC-50)", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Committed live key"));

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mockFindingAction).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr-1" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockFindingAction).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: "pr-1" });

    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(mockCreateEvalCase).toHaveBeenCalledWith("f1", expect.anything());
  });

  it("renders Learn disabled with a tooltip and issues nothing; no Reply to author exists (AC-51)", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Committed live key"));

    const learn = screen.getByRole("button", { name: "Learn" });
    expect(learn).toBeDisabled();
    expect(learn).toHaveAttribute("title", "Arrives with the Memory feature");

    fireEvent.click(learn);
    expect(mockFindingAction).not.toHaveBeenCalled();
    expect(mockCreateEvalCase).not.toHaveBeenCalled();

    expect(screen.queryByText(/reply to author/i)).not.toBeInTheDocument();
  });

  it("keeps an accepted finding visible, carrying its state (edge case)", () => {
    const agents = [
      makeAgent({
        run_id: "run-1",
        agent_name: "Security",
        findings: [makeFinding({ id: "f1", title: "Committed live key", accepted_at: "2026-08-02T00:00:00Z" })],
      }),
    ];
    renderTabs(agents);
    expect(screen.getByText("Committed live key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Committed live key"));
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });
});
