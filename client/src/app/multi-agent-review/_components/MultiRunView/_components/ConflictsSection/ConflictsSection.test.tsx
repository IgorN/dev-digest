/**
 * ConflictsSection — "Where agents disagree" (AC-54 – AC-59).
 *
 * Covers: the group header's `file:line` + label (AC-54); one cell per
 * participating agent in the multi-run's agent order (AC-55, AC-59);
 * `Show only conflicts` hiding the unanimous groups (AC-57); the zero-group
 * empty state (AC-58); a non-flagging cell rendering the grey dot and text with
 * NO rationale line (AC-56 + the spec's accepted deviation); and a failed
 * agent's cell reading `no result`, never `did not flag` (AC-13, AC-56).
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiRunAgent, MultiRunGroup } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";
import { ConflictsSection } from "./ConflictsSection";

afterEach(cleanup);

const AGENTS = [
  { agent_id: "agent-1", agent_name: "Junior Mentor", run_id: "run-1", status: "done", findings: [] },
  { agent_id: "agent-2", agent_name: "Security", run_id: "run-2", status: "done", findings: [] },
  { agent_id: "agent-3", agent_name: "Architecture", run_id: "run-3", status: "failed", findings: [] },
] as unknown as MultiRunAgent[];

const MIXED: MultiRunGroup = {
  file: "src/middleware/ratelimit.ts",
  line: 28,
  label: "Magic number 3600",
  conflict: true,
  cells: [
    {
      agent_id: "agent-1",
      verdict: "flagged",
      severity: "SUGGESTION",
      rationale: "Extract for readability.",
      finding_id: "f1",
    },
    { agent_id: "agent-2", verdict: "did_not_flag" },
    { agent_id: "agent-3", verdict: "no_result" },
  ],
};

const UNANIMOUS: MultiRunGroup = {
  file: "src/middleware/ratelimit.ts",
  line: 52,
  label: "429 response shape",
  conflict: false,
  cells: [
    { agent_id: "agent-1", verdict: "flagged", severity: "WARNING", rationale: "Needs a code." },
    { agent_id: "agent-2", verdict: "flagged", severity: "WARNING", rationale: "Same." },
    { agent_id: "agent-3", verdict: "no_result" },
  ],
};

function renderSection(groups: MultiRunGroup[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ConflictsSection groups={groups} agents={AGENTS} />
    </NextIntlClientProvider>,
  );
}

describe("ConflictsSection", () => {
  it("renders the group location and label (AC-54)", () => {
    renderSection([MIXED]);
    expect(screen.getByText("src/middleware/ratelimit.ts:28")).toBeInTheDocument();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
  });

  it("renders one cell per participating agent, in agent order (AC-55, AC-59)", () => {
    renderSection([MIXED]);
    const names = screen.getAllByText(/Junior Mentor|Security|Architecture/);
    expect(names.map((n) => n.textContent)).toEqual(["Junior Mentor", "Security", "Architecture"]);
  });

  it("shows the flagging agent's severity + rationale and NO rationale on non-flagging cells (AC-56, deviation)", () => {
    renderSection([MIXED]);
    expect(screen.getByText("SUGGESTION")).toBeInTheDocument();
    expect(screen.getByText("Extract for readability.")).toBeInTheDocument();

    const didNotFlag = screen.getByText("did not flag");
    const cell = didNotFlag.closest("div")!.parentElement!;
    // Agent name + verdict text only — no third, manufactured rationale line.
    expect(cell.textContent).toBe("Securitydid not flag");
  });

  it("reads `no result` for a failed agent, never `did not flag` (AC-13, AC-56)", () => {
    renderSection([MIXED]);
    const noResult = screen.getByText("no result");
    expect(noResult).toBeInTheDocument();
    expect(noResult.closest("div")!.parentElement!.textContent).toBe("Architectureno result");
    expect(screen.getAllByText("did not flag")).toHaveLength(1);
  });

  it("hides the unanimous group when Show only conflicts is on (AC-57)", () => {
    renderSection([MIXED, UNANIMOUS]);
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("429 response shape")).toBeInTheDocument();

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.queryByText("429 response shape")).not.toBeInTheDocument();
  });

  it("renders an explicit empty state when no agent produced any finding (AC-58)", () => {
    renderSection([]);
    expect(screen.getByText("Nothing to compare yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No agent flagged a location in this run, so there is nothing to line up side by side.",
      ),
    ).toBeInTheDocument();
  });

  it("says the agents agree when the toggle filters every group away (AC-57)", () => {
    renderSection([UNANIMOUS]);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("The agents agree")).toBeInTheDocument();
  });
});
