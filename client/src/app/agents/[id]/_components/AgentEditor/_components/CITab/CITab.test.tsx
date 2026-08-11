/**
 * CITab — the agent editor's CI tab (L08 Export to CI). Covers the empty branch
 * and its `Add to CI` CTA (AC-55), the populated header + active-repo badge
 * (AC-56), an installation row's repo / target badge / status badge / workflow
 * version / relative timestamp (AC-57), the explicit pending state for an
 * un-ingested installation (AC-58), the `Fail CI on` control persisting through
 * `useUpdateAgent` including the `any` edge case (AC-59), the drift notice
 * (AC-60), and the dashed `Add repository` control (AC-61).
 *
 * Hooks mocked at the `@/lib/hooks/*` boundary; the wizard is stubbed so this
 * file tests the tab only. `fireEvent`, not `userEvent` — the latter is not
 * installed (client/INSIGHTS.md, 2026-07-12).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";

const hoisted = vi.hoisted(() => ({
  useCiInstallations: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("@/lib/hooks/ci-export", () => ({
  useCiInstallations: (...args: unknown[]) => hoisted.useCiInstallations(...args),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: hoisted.updateMutate, isPending: false }),
}));

vi.mock("./_components/ExportWizard", () => ({
  ExportWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="export-wizard">
      <button onClick={onClose}>close-wizard</button>
    </div>
  ),
}));

import { CITab } from "./CITab";

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets",
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  system_prompt: "You review PRs.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
  skill_count: 2,
};

function makeInstallation(over: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "inst-1",
    agent_id: "agent-1",
    workspace_id: "ws-1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-08-01T10:00:00.000Z",
    post_as: "github_review",
    triggers: ["opened", "synchronize"],
    base: "main",
    manifest_path: ".devdigest/agents/security-reviewer.yaml",
    workflow_path: ".github/workflows/devdigest-review.yml",
    workflow_version: 3,
    pr_url: "https://github.com/acme/payments-api/pull/9",
    last_ingest_at: null,
    exported_ci_fail_on: "critical",
    status: null,
    last_activity_at: null,
    policy_drift: false,
    ...over,
  };
}

function renderTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CITab agent={agent} />
    </NextIntlClientProvider>,
  );
}

function setInstallations(rows: CiInstallation[]) {
  hoisted.useCiInstallations.mockReturnValue({ data: rows, isLoading: false });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CITab", () => {
  it("renders the empty state and opens the wizard from `Add to CI` (AC-55)", () => {
    setInstallations([]);
    renderTab();

    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deploy this agent to run automatically on every pull request in a repo's CI pipeline.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("export-wizard")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to CI" }));
    expect(screen.getByTestId("export-wizard")).toBeInTheDocument();
  });

  it("renders the deployment header with the active-repo count and both actions (AC-56)", () => {
    setInstallations([makeInstallation(), makeInstallation({ id: "inst-2", repo: "acme/billing" })]);
    renderTab();

    expect(screen.getByText("CI deployment")).toBeInTheDocument();
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to CI" })).toBeInTheDocument();
  });

  it("renders a row's repo, target badge, workflow version and relative timestamp, with the explicit pending state before the first ingest (AC-57, AC-58)", () => {
    setInstallations([
      makeInstallation({
        status: null,
        last_activity_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      }),
    ]);
    renderTab();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.getByText("workflow v3")).toBeInTheDocument();
    expect(screen.getByText("4m ago")).toBeInTheDocument();
    expect(screen.getByText("Pending first run")).toBeInTheDocument();
    expect(screen.queryByText("Succeeded")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("renders the ingested status once a run has arrived", () => {
    setInstallations([
      makeInstallation({ status: "succeeded", last_activity_at: new Date().toISOString() }),
    ]);
    renderTab();

    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Pending first run")).not.toBeInTheDocument();
  });

  it("persists a `Fail CI on` change through useUpdateAgent and keeps the new selection (AC-59)", () => {
    setInstallations([makeInstallation()]);
    renderTab();

    const group = screen.getByRole("radiogroup", { name: "Fail CI on" });
    expect(within(group).getByRole("radio", { name: "Critical" })).toBeChecked();

    fireEvent.click(within(group).getByRole("radio", { name: "Warning +" }));

    expect(hoisted.updateMutate).toHaveBeenCalledTimes(1);
    expect(hoisted.updateMutate.mock.calls[0]![0]).toEqual({
      id: "agent-1",
      patch: { ci_fail_on: "warning" },
    });
    expect(within(group).getByRole("radio", { name: "Warning +" })).toBeChecked();
  });

  it("renders NO active option and issues no mutation when the stored policy is the fourth value `any` (edge case)", () => {
    setInstallations([makeInstallation()]);
    renderTab({ ...AGENT, ci_fail_on: "any" });

    const group = screen.getByRole("radiogroup", { name: "Fail CI on" });
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect(hoisted.updateMutate).not.toHaveBeenCalled();
  });

  it("renders the drift notice only for an installation whose policy drifted (AC-60)", () => {
    setInstallations([
      makeInstallation({ id: "inst-1", repo: "acme/drifted", policy_drift: true, exported_ci_fail_on: "never" }),
      makeInstallation({ id: "inst-2", repo: "acme/clean", policy_drift: false }),
    ]);
    renderTab();

    const notices = screen.getAllByText(/CI still runs the previously exported policy/);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent("(never)");
  });

  it("opens the wizard from the dashed `Add repository` control (AC-61)", () => {
    setInstallations([makeInstallation()]);
    renderTab();

    expect(screen.queryByTestId("export-wizard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    expect(screen.getByTestId("export-wizard")).toBeInTheDocument();
  });
});
