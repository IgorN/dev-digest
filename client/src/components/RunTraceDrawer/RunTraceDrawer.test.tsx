import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../messages/en/runs.json"; // client/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
// `mockState.trace` is swapped per test (old-shape trace vs specs_injected trace).
const mockState = vi.hoisted(() => ({ trace: undefined as unknown }));

const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed", cost_usd: 0.06 },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

const SPECS_TEXT = '## Project context\n<untrusted source="spec-0">Auth uses JWT.</untrusted>';

// Trace with injected project-context docs (new specs_injected field).
const INJECTED_TRACE: RunTrace = {
  ...TRACE,
  prompt_assembly: { ...TRACE.prompt_assembly, specs: SPECS_TEXT },
  specs_read: ["docs/adr/001-auth.md", "specs/big-spec.md"],
  specs_injected: [
    { path: "docs/adr/001-auth.md", tokens: 812, status: "injected" },
    { path: "specs/big-spec.md", tokens: 640, status: "truncated" },
    { path: "insights/deleted.md", tokens: 0, status: "skipped_missing" },
  ],
};

vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: mockState.trace, isLoading: false }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

beforeEach(() => {
  mockState.trace = TRACE;
});
afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    // Stats COST tile reflects the trace's cost_usd (0.06 → "$0.060", 3-dp <$1).
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
    // Old-shape trace (no specs_injected) renders with no Context docs row.
    expect(screen.queryByText("Context docs")).not.toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  it("renders injected context docs with path, token size and status", () => {
    mockState.trace = INJECTED_TRACE;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Context docs")).toBeInTheDocument();
    // Injected paths appear twice: once as a Specs-read chip (unchanged display),
    // once as a Context-docs entry.
    expect(screen.getAllByText("docs/adr/001-auth.md")).toHaveLength(2);
    expect(screen.getByText("812 tokens")).toBeInTheDocument();
    expect(screen.getByText("injected")).toBeInTheDocument();
    expect(screen.getAllByText("specs/big-spec.md")).toHaveLength(2);
    expect(screen.getByText("640 tokens")).toBeInTheDocument();
    expect(screen.getByText("truncated")).toBeInTheDocument();
    // A skipped doc was never injected → not in specs_read, listed once.
    expect(screen.getAllByText("insights/deleted.md")).toHaveLength(1);
    expect(screen.getByText("0 tokens")).toBeInTheDocument();
    expect(screen.getByText("skipped (missing)")).toBeInTheDocument();
  });

  it("expands and copies the Project context prompt block", () => {
    mockState.trace = INJECTED_TRACE;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    // Prompt assembly section is collapsed by default — open it first.
    fireEvent.click(screen.getByText("Prompt assembly"));
    const head = screen.getByText("Project context — attached specs (untrusted)").closest("div")!;
    fireEvent.click(head); // expand the specs block
    expect(screen.getByText(/Auth uses JWT\./)).toBeInTheDocument();
    fireEvent.click(within(head).getByLabelText("Copy"));
    expect(writeText).toHaveBeenCalledWith(SPECS_TEXT);
  });
});

describe("A5 Run Trace drawer — specs_injected edge cases", () => {
  it("renders the Context docs row with 'none' for an EMPTY specs_injected array (present ≠ absent)", () => {
    // [] means "new-shape trace, zero docs injected" — the row must render,
    // unlike the old-shape trace (specs_injected undefined) where it's hidden.
    mockState.trace = { ...TRACE, specs_injected: [] } satisfies RunTrace;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    expect(screen.getByText("Context docs")).toBeInTheDocument();
    // both "Specs read" (specs_read: []) and "Context docs" show the none label
    expect(screen.getAllByText("none")).toHaveLength(2);
  });
});
