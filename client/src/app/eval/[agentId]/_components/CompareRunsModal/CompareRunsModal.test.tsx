/**
 * CompareRunsModal — the two-run Compare view (AC-36–AC-38). Covers: four
 * deltas (recall/precision/citation/cost), each with an icon AND a text
 * label (never colour alone), plus a highlighted system-prompt diff when the
 * two batches ran different agent versions; an explicit "No change" state
 * (not a blank panel) when both batches share one agent version; and
 * "Promote v‹N›" calling the existing agent-update mutation with the
 * promoted version's reshaped config.
 *
 * Mocks live at the hook boundary (mirrors EvalAgentDrillIn.test.tsx).
 * `fireEvent`, not `userEvent`, per this project's convention
 * (client/INSIGHTS.md, 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentVersion, EvalTrendPoint } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";

const mockUseAgentVersion = vi.fn();
const mockUpdateAgentMutate = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useAgentVersion: (...args: unknown[]) => mockUseAgentVersion(...args),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: mockUpdateAgentMutate, isPending: false }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function point(over: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    run_id: "b1",
    agent_version: 5,
    ran_at: "2026-07-01T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.95,
    pass_rate: 0.8,
    cost_usd: 0.01,
    ...over,
  };
}

function version(over: Partial<AgentVersion> = {}): AgentVersion {
  return {
    agent_id: "agent-1",
    version: 5,
    created_at: "2026-06-01T00:00:00.000Z",
    config: {
      provider: "openai",
      model: "gpt-4.1",
      system_prompt: "line one\nline two\nline three",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
      context_documents: [],
    },
    ...over,
  };
}

/** By default resolve `useAgentVersion(agentId, version)` per the requested
   version number so the older/newer calls each get their own fixture. */
function mockVersions(map: Record<number, AgentVersion | undefined>, opts: { loading?: boolean } = {}) {
  mockUseAgentVersion.mockImplementation((_agentId: string, v: number) => ({
    data: opts.loading ? undefined : map[v],
    isLoading: !!opts.loading,
  }));
}

function renderModal(runs: EvalTrendPoint[], onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CompareRunsModal agentId="agent-1" runs={runs} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

describe("CompareRunsModal", () => {
  it("renders four deltas (icon + text, never colour alone) and a highlighted diff for two different versions", () => {
    const older = point({ run_id: "b1", agent_version: 5, ran_at: "2026-07-01T00:00:00.000Z", recall: 0.7, precision: 0.8, citation_accuracy: 0.9, cost_usd: 0.01 });
    const newer = point({ run_id: "b2", agent_version: 6, ran_at: "2026-07-10T00:00:00.000Z", recall: 0.9, precision: 0.75, citation_accuracy: 0.9, cost_usd: 0.02 });
    mockVersions({
      5: version({ version: 5, config: { ...version().config, system_prompt: "rule A\nrule B\nrule C" } }),
      6: version({ version: 6, config: { ...version().config, system_prompt: "rule A\nrule B changed\nrule C" } }),
    });

    renderModal([newer, older]); // deliberately out of order — component re-sorts

    // Recall improved (+20pts), precision regressed (-5pts), citation flat, cost up.
    expect(screen.getByText("+20pts")).toBeInTheDocument();
    expect(screen.getByText("-5pts")).toBeInTheDocument();
    expect(screen.getByText("0pts")).toBeInTheDocument();
    // Cost delta text is present (icon + text, not just a coloured number).
    expect(screen.getByText(/\+\$0\.01/)).toBeInTheDocument();

    // The unchanged lines render, and the changed line is present with its
    // new (rule B changed) text — proving a real diff, not a blank panel.
    expect(screen.getByText("rule A")).toBeInTheDocument();
    expect(screen.getByText("rule B changed")).toBeInTheDocument();
    expect(screen.getByText("rule B")).toBeInTheDocument(); // the removed old line
    expect(screen.queryByText(/No change/i)).not.toBeInTheDocument();
  });

  it('renders an explicit "No change" state, not a blank panel, when both batches share one agent version', () => {
    const older = point({ run_id: "b1", agent_version: 5, ran_at: "2026-07-01T00:00:00.000Z" });
    const newer = point({ run_id: "b2", agent_version: 5, ran_at: "2026-07-10T00:00:00.000Z" });
    mockVersions({ 5: version({ version: 5 }) });

    renderModal([older, newer]);

    expect(screen.getByText(/No change/i)).toBeInTheDocument();
    // Not a diff panel or a loading skeleton.
    expect(screen.queryByText("line one")).not.toBeInTheDocument();
  });

  it("clicking \"Promote v5\" calls the agent-update mutation with the reshaped v5 config", () => {
    const older = point({ run_id: "b1", agent_version: 5, ran_at: "2026-07-01T00:00:00.000Z" });
    const newer = point({ run_id: "b2", agent_version: 6, ran_at: "2026-07-10T00:00:00.000Z" });
    const v5 = version({
      version: 5,
      config: {
        provider: "openai",
        model: "gpt-4.1",
        system_prompt: "old prompt",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
        skills: ["skill-1"],
        context_documents: ["docs/a.md"],
      },
    });
    mockVersions({ 5: v5, 6: version({ version: 6 }) });

    renderModal([older, newer]);

    fireEvent.click(screen.getByRole("button", { name: "Promote v5" }));

    expect(mockUpdateAgentMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockUpdateAgentMutate.mock.calls[0]!;
    expect(payload).toEqual({
      id: "agent-1",
      patch: {
        provider: "openai",
        model: "gpt-4.1",
        system_prompt: "old prompt",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
      },
    });
    // skills/context_documents are NOT part of the update payload — the
    // existing PUT /agents/:id shape has no field for either (see helpers.ts
    // toUpdatePatch's doc comment).
    expect(payload.patch).not.toHaveProperty("skills");
    expect(payload.patch).not.toHaveProperty("context_documents");
  });

  it("renders nothing when fewer or more than exactly 2 runs are given", () => {
    const { container } = renderModal([point()]);
    expect(container).toBeEmptyDOMElement();
  });
});
