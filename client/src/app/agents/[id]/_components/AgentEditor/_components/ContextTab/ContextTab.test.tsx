/**
 * Agent editor ContextTab — toggling a document persists the FULL ordered path
 * set (AC-5 UI half), drag-reorder emits the new order (AC-9 UI half), and the
 * footer's deterministic "≈ N tokens" total updates on toggle (AC-14).
 * Hooks are vi.mock'ed (house pattern — no MSW in this repo).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import contextMessages from "../../../../../../../../messages/en/context.json";

const mockInventory = vi.fn();
const mockPreview = vi.fn();
const mockMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/context", () => ({
  useContextInventory: (...args: unknown[]) => mockInventory(...args),
  useContextDocumentPreview: (...args: unknown[]) => mockPreview(...args),
  useSetAgentContextDocuments: () => ({ mutate: mockMutate }),
}));
vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    setRepoId: () => {},
    repos: [],
    activeRepo: { id: "r1", full_name: "acme/payments-api" },
    reposLoaded: true,
  }),
}));

import { ContextTab } from "./ContextTab";

const ITEMS = [
  { path: "specs/alpha.md", root: "specs", token_estimate: 100 },
  { path: "docs/guide/beta.md", root: "docs", token_estimate: 50 },
  { path: "insights/gamma.md", root: "insights", token_estimate: 25 },
];

const idleQuery = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

function makeAgent(contextDocuments: string[]): Agent {
  return {
    id: "ag1",
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
    skill_count: 0,
    context_documents: contextDocuments,
  };
}

function renderTab(agent: Agent, previewImpl?: (repoId: unknown, path: unknown) => unknown) {
  mockInventory.mockReturnValue({
    data: { repo_id: "r1", has_clone: true, count: ITEMS.length, items: ITEMS },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  if (previewImpl) mockPreview.mockImplementation(previewImpl);
  else mockPreview.mockReturnValue(idleQuery);
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Agent ContextTab", () => {
  it("toggling a document ON persists the full ordered set (existing + new last)", () => {
    renderTab(makeAgent(["specs/alpha.md"]));

    // Rows render attached-first: alpha (attached), then beta, gamma.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checkboxes[1]!); // beta.md
    expect(mockMutate).toHaveBeenCalledWith(["specs/alpha.md", "docs/guide/beta.md"]);
  });

  it("toggling a document OFF persists the remaining ordered set", () => {
    renderTab(makeAgent(["specs/alpha.md", "docs/guide/beta.md"]));

    fireEvent.click(screen.getAllByRole("checkbox")[0]!); // detach alpha.md
    expect(mockMutate).toHaveBeenCalledWith(["docs/guide/beta.md"]);
  });

  it("drag-reorder emits the new full ordered set", () => {
    renderTab(makeAgent(["specs/alpha.md", "docs/guide/beta.md"]));

    const rowAlpha = screen.getByText("alpha.md").closest('[draggable="true"]')!;
    const rowBeta = screen.getByText("beta.md").closest('[draggable="true"]')!;

    fireEvent.dragStart(rowBeta);
    fireEvent.dragOver(rowAlpha);
    fireEvent.drop(rowAlpha);

    expect(mockMutate).toHaveBeenCalledWith(["docs/guide/beta.md", "specs/alpha.md"]);
  });

  it("footer shows the deterministic token total and updates on toggle (AC-14)", () => {
    renderTab(makeAgent(["specs/alpha.md"]));

    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // attach beta.md (+50)
    expect(screen.getByText("≈ 150 tokens")).toBeInTheDocument();

    // counter chip follows too
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
  });

  it("per-row preview affordance renders the document markdown", () => {
    renderTab(makeAgent(["specs/alpha.md"]), (_repoId, path) =>
      path === "specs/alpha.md"
        ? {
            data: {
              repo_id: "r1",
              path,
              root: "specs",
              content: "# Alpha Spec\n\nBody text.",
              truncated: false,
              token_estimate: 100,
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }
        : idleQuery,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show preview of alpha.md" }));

    // markdown is RENDERED (heading), not raw source
    expect(screen.getByRole("heading", { name: "Alpha Spec" })).toBeInTheDocument();
    expect(screen.queryByText("# Alpha Spec")).not.toBeInTheDocument();
  });
});

/** Renders the tab with a caller-supplied inventory payload (empty-state and
 *  no-clone branches — the shared `renderTab` helper hardcodes a full one). */
function renderTabWithInventory(
  agent: Agent,
  inventory: { repo_id: string; has_clone: boolean; count: number; items: unknown[] },
) {
  mockInventory.mockReturnValue({
    data: inventory,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockPreview.mockReturnValue(idleQuery);
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

describe("Agent ContextTab — filter, ordering, stale paths, preview exclusivity", () => {
  it("filter narrows rows by full-path substring (folders too) and clearing restores", () => {
    renderTab(makeAgent([]));

    // nothing attached → deterministic zero total
    expect(screen.getByText("≈ 0 tokens")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Filter documents…");
    // "guide" only exists in beta's FOLDER path, not any file name
    fireEvent.change(input, { target: { value: "guide" } });
    expect(screen.getByText("beta.md")).toBeInTheDocument();
    expect(screen.queryByText("alpha.md")).not.toBeInTheDocument();
    expect(screen.queryByText("gamma.md")).not.toBeInTheDocument();

    // the attached counter reflects the full inventory, not the filtered view
    expect(screen.getByText("0 of 3 attached")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("alpha.md")).toBeInTheDocument();
    expect(screen.getByText("gamma.md")).toBeInTheDocument();
  });

  it("renders attached rows first in the agent's stored order, not inventory order", () => {
    renderTab(makeAgent(["insights/gamma.md", "specs/alpha.md"]));

    // DOM order: attached (gamma, alpha — the stored order) then the rest (beta)
    const names = screen.getAllByText(/\.md$/).map((el) => el.textContent);
    expect(names).toEqual(["gamma.md", "alpha.md", "beta.md"]);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[2]).toHaveAttribute("aria-checked", "false");
  });

  it("keeps a stale attached path (missing from inventory): no row, counts 0 tokens, never dropped from persists", () => {
    renderTab(makeAgent(["specs/deleted.md", "specs/alpha.md"]));

    // the stale path renders no row…
    expect(screen.queryByText("deleted.md")).not.toBeInTheDocument();
    // …but still counts as attached, contributing 0 to the token total
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();

    // attaching another doc persists the FULL set with the stale path intact, in position
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // beta.md (rows: alpha, beta, gamma)
    expect(mockMutate).toHaveBeenCalledWith([
      "specs/deleted.md",
      "specs/alpha.md",
      "docs/guide/beta.md",
    ]);
  });

  it("drag-reorder under an active filter still operates on the full attached set", () => {
    renderTab(makeAgent(["specs/alpha.md", "docs/guide/beta.md", "insights/gamma.md"]));

    // "c" matches specs/alpha.md and docs/guide/beta.md but not insights/gamma.md
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), {
      target: { value: "c" },
    });
    expect(screen.queryByText("gamma.md")).not.toBeInTheDocument();

    const rowAlpha = screen.getByText("alpha.md").closest('[draggable="true"]')!;
    const rowBeta = screen.getByText("beta.md").closest('[draggable="true"]')!;
    fireEvent.dragStart(rowBeta);
    fireEvent.dragOver(rowAlpha);
    fireEvent.drop(rowAlpha);

    // gamma.md — hidden by the filter — keeps its slot in the persisted order
    expect(mockMutate).toHaveBeenCalledWith([
      "docs/guide/beta.md",
      "specs/alpha.md",
      "insights/gamma.md",
    ]);
  });

  it("opening a second row's preview closes the first (one preview at a time), and toggling closes it", () => {
    const doc = (path: string, content: string) => ({
      data: { repo_id: "r1", path, root: "specs", content, truncated: false, token_estimate: 10 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderTab(makeAgent([]), (_repoId, path) =>
      path === "specs/alpha.md"
        ? doc(path as string, "# Alpha Doc")
        : path === "docs/guide/beta.md"
          ? doc(path as string, "# Beta Doc")
          : idleQuery,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show preview of alpha.md" }));
    expect(screen.getByRole("heading", { name: "Alpha Doc" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show preview of beta.md" }));
    expect(screen.getByRole("heading", { name: "Beta Doc" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha Doc" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide preview of beta.md" }));
    expect(screen.queryByRole("heading", { name: "Beta Doc" })).not.toBeInTheDocument();
  });

  it("shows the no-clone empty state (AC-4) instead of the list or footer", () => {
    renderTabWithInventory(makeAgent([]), {
      repo_id: "r1",
      has_clone: false,
      count: 0,
      items: [],
    });

    expect(screen.getByText("No local clone yet")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("≈ 0 tokens")).not.toBeInTheDocument();
  });

  it("shows the no-docs empty state for a cloned repo with an empty inventory", () => {
    renderTabWithInventory(makeAgent([]), {
      repo_id: "r1",
      has_clone: true,
      count: 0,
      items: [],
    });

    expect(screen.getByText("No context documents found")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
