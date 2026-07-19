/**
 * ProjectContextView — inventory list (paths + root badges + token estimates),
 * click-to-preview through the sanitizing Markdown primitive, and the no-clone
 * explanatory empty state (AC-4: an expected state, never an error).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import contextMessages from "../../../../../messages/en/context.json";

const mockInventory = vi.fn();
const mockPreview = vi.fn();
vi.mock("../../../../lib/hooks/context", () => ({
  useContextInventory: (...args: unknown[]) => mockInventory(...args),
  useContextDocumentPreview: (...args: unknown[]) => mockPreview(...args),
}));
vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    setRepoId: () => {},
    repos: [],
    activeRepo: { id: "r1", full_name: "acme/payments-api" },
    reposLoaded: true,
  }),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ProjectContextView } from "./ProjectContextView";

const ITEMS = [
  { path: "docs/api/overview.md", root: "docs", token_estimate: 123 },
  { path: "specs/lessons/review-flow.md", root: "specs", token_estimate: 456 },
];

const idleQuery = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectContextView", () => {
  it("renders the inventory with file names, folder paths, root badges and token estimates", () => {
    mockInventory.mockReturnValue({
      data: { repo_id: "r1", has_clone: true, count: 2, items: ITEMS },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockPreview.mockReturnValue(idleQuery);
    renderView();

    // file name + its folder path, per row
    expect(screen.getByText("overview.md")).toBeInTheDocument();
    expect(screen.getByText("docs/api")).toBeInTheDocument();
    expect(screen.getByText("review-flow.md")).toBeInTheDocument();
    expect(screen.getByText("specs/lessons")).toBeInTheDocument();

    // root badges
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();

    // per-doc token estimates
    expect(screen.getByText("≈ 123 tok")).toBeInTheDocument();
    expect(screen.getByText("≈ 456 tok")).toBeInTheDocument();

    // nothing selected yet → preview placeholder, not a document
    expect(screen.getByText("Select a document")).toBeInTheDocument();
  });

  it("renders the selected document's markdown in the preview pane on click", () => {
    mockInventory.mockReturnValue({
      data: { repo_id: "r1", has_clone: true, count: 2, items: ITEMS },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockPreview.mockImplementation((_repoId: unknown, path: unknown) =>
      path === "docs/api/overview.md"
        ? {
            data: {
              repo_id: "r1",
              path,
              root: "docs",
              content: "# Hello Preview\n\nBody text.",
              truncated: false,
              token_estimate: 123,
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }
        : idleQuery,
    );
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /overview\.md/ }));

    // markdown is RENDERED (heading + paragraph), not shown as raw source
    expect(screen.getByRole("heading", { name: "Hello Preview" })).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    expect(screen.queryByText("# Hello Preview")).not.toBeInTheDocument();
    // preview header repeats the full repo-relative path
    expect(screen.getByText("docs/api/overview.md")).toBeInTheDocument();
  });

  it("shows the explanatory empty state for a repo without a clone — not an error", () => {
    mockInventory.mockReturnValue({
      data: { repo_id: "r1", has_clone: false, count: 0, items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockPreview.mockReturnValue(idleQuery);
    renderView();

    expect(screen.getByText("No local clone yet")).toBeInTheDocument();
    expect(screen.queryByText("Could not load context documents.")).not.toBeInTheDocument();
  });
});

describe("ProjectContextView — preview switching, truncation, empty and error states", () => {
  it("switches the preview between documents and shows the Truncated badge for a capped doc", () => {
    mockInventory.mockReturnValue({
      data: { repo_id: "r1", has_clone: true, count: 2, items: ITEMS },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockPreview.mockImplementation((_repoId: unknown, path: unknown) =>
      path === "docs/api/overview.md"
        ? {
            data: {
              repo_id: "r1",
              path,
              root: "docs",
              content: "# Overview Doc",
              truncated: false,
              token_estimate: 123,
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }
        : path === "specs/lessons/review-flow.md"
          ? {
              data: {
                repo_id: "r1",
                path,
                root: "specs",
                content: "# Review Flow Doc",
                truncated: true,
                token_estimate: 456,
              },
              isLoading: false,
              isError: false,
              refetch: vi.fn(),
            }
          : idleQuery,
    );
    renderView();

    // first doc: rendered, NOT truncated → no badge
    fireEvent.click(screen.getByRole("button", { name: /overview\.md/ }));
    expect(screen.getByRole("heading", { name: "Overview Doc" })).toBeInTheDocument();
    expect(screen.queryByText("Truncated")).not.toBeInTheDocument();

    // switch selection: pane swaps to the second doc and surfaces its truncation
    fireEvent.click(screen.getByRole("button", { name: /review-flow\.md/ }));
    expect(screen.getByRole("heading", { name: "Review Flow Doc" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Overview Doc" })).not.toBeInTheDocument();
    expect(screen.getByText("Truncated")).toBeInTheDocument();
  });

  it("shows the no-docs empty state for a cloned repo whose inventory is empty", () => {
    mockInventory.mockReturnValue({
      data: { repo_id: "r1", has_clone: true, count: 0, items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockPreview.mockReturnValue(idleQuery);
    renderView();

    expect(screen.getByText("No context documents found")).toBeInTheDocument();
    // no list/preview split is rendered at all
    expect(screen.queryByText("Select a document")).not.toBeInTheDocument();
  });

  it("shows the error state with a working retry when the inventory query fails", () => {
    const refetch = vi.fn();
    mockInventory.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    mockPreview.mockReturnValue(idleQuery);
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load context documents.");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
