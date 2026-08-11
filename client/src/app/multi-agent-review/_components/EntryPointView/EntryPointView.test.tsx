/**
 * EntryPointView — the conditional landing at `/multi-agent-review`
 * (AC-22, AC-22a, AC-22b).
 *
 * Covers: `{ multi_run: null }` rendering the Configure-run form's H1 and
 * sub-line (AC-22); a resolved multi-run rendering the result view for that id
 * and NOT the form (AC-22a); a still-running multi-run still landing on the
 * result (edge case); the empty branch being driven by `data.multi_run === null`
 * on a SUCCESSFUL query rather than by an error state (AC-22b); and no
 * navigation being issued in either branch, so the Back button is never trapped.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { LatestMultiRunResponse } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";

const mockUseLatestMultiRun = vi.fn();
const mockMultiRunView = vi.fn();
const mockConfigureRunView = vi.fn();
const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1", activeRepo: null, repos: [], reposLoaded: true }),
}));
vi.mock("@/lib/hooks/multi-runs", () => ({
  useLatestMultiRun: (...args: unknown[]) => mockUseLatestMultiRun(...args),
}));
// Both branches are stubbed to their identifying copy — this test is about
// WHICH subtree gets picked, not about re-testing either of them.
vi.mock("../MultiRunView", () => ({
  MultiRunView: (props: { multiRunId: string }) => {
    mockMultiRunView(props);
    return <div data-testid="multi-run-view">{props.multiRunId}</div>;
  },
}));
vi.mock("../ConfigureRunView", () => ({
  ConfigureRunView: () => {
    mockConfigureRunView();
    return (
      <div>
        <h1>Run a Multi-Agent Review</h1>
        <p>
          Pick a pull request and choose which agents to fan out — they run in parallel and you compare
          their findings side by side.
        </p>
      </div>
    );
  },
}));

import { EntryPointView } from "./EntryPointView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderEntry(state: { data?: LatestMultiRunResponse; isLoading?: boolean; isError?: boolean }) {
  mockUseLatestMultiRun.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <EntryPointView />
    </NextIntlClientProvider>,
  );
}

const REF = {
  id: "mr-9",
  pr_id: "pr-1",
  pr_number: 1,
  pr_title: "add notes search",
  ran_at: "2026-08-02T10:00:00.000Z",
};

describe("EntryPointView", () => {
  it("renders the Configure-run form when the scope has no multi-run (AC-22)", () => {
    renderEntry({ data: { multi_run: null } });

    expect(screen.getByText("Run a Multi-Agent Review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick a pull request and choose which agents to fan out — they run in parallel and you compare their findings side by side.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("multi-run-view")).not.toBeInTheDocument();
  });

  it("renders the most recent multi-run's result view, not the form (AC-22a)", () => {
    renderEntry({ data: { multi_run: REF } });

    expect(screen.getByTestId("multi-run-view")).toHaveTextContent("mr-9");
    expect(mockMultiRunView).toHaveBeenCalledWith({ multiRunId: "mr-9" });
    expect(mockConfigureRunView).not.toHaveBeenCalled();
    expect(screen.queryByText("Run a Multi-Agent Review")).not.toBeInTheDocument();
  });

  it("takes the empty branch from a SUCCESSFUL `multi_run: null`, never from an error (AC-22b)", () => {
    // The resolver answers 2xx with an explicit null; `isError` stays false and
    // is not what drives the branch.
    renderEntry({ data: { multi_run: null }, isError: false });
    expect(mockConfigureRunView).toHaveBeenCalledTimes(1);
    expect(mockUseLatestMultiRun).toHaveBeenCalledWith({ repoId: "repo-1" });
  });

  it("still lands on an in-flight multi-run rather than falling back to the form (edge case)", () => {
    // "Still running" is not visible to this leaf at all: the resolver returns a
    // reference, and MultiRunView opens it in its live state.
    renderEntry({ data: { multi_run: REF } });
    expect(screen.getByTestId("multi-run-view")).toBeInTheDocument();
    expect(mockConfigureRunView).not.toHaveBeenCalled();
  });

  it("issues no navigation in either branch (back-button safety)", () => {
    renderEntry({ data: { multi_run: REF } });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    cleanup();
    renderEntry({ data: { multi_run: null } });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders neither branch while the resolver is still loading", () => {
    renderEntry({ data: undefined, isLoading: true });
    expect(screen.queryByTestId("multi-run-view")).not.toBeInTheDocument();
    expect(mockConfigureRunView).not.toHaveBeenCalled();
  });
});
