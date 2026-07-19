/**
 * Skill editor ContextTab — toggling persists the FULL ordered path set via
 * the skill mutation (AC-6 UI half), the footer token total updates on toggle
 * (AC-14), and the read-only "serializes as" block lists the attached paths
 * under "## Project specifications" with the inheritance hint.
 * Hooks are vi.mock'ed (house pattern — no MSW in this repo).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import contextMessages from "../../../../../../../../messages/en/context.json";

const mockInventory = vi.fn();
const mockPreview = vi.fn();
const mockMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/context", () => ({
  useContextInventory: (...args: unknown[]) => mockInventory(...args),
  useContextDocumentPreview: (...args: unknown[]) => mockPreview(...args),
  useSetSkillContextDocuments: () => ({ mutate: mockMutate }),
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
];

const idleQuery = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

function makeSkill(contextDocuments: string[]): Skill {
  return {
    id: "sk1",
    name: "security-baseline",
    description: "Security review rules",
    type: "security",
    source: "manual",
    body: "## Skill\nCheck for secrets.",
    enabled: true,
    version: 1,
    evidence_files: null,
    context_documents: contextDocuments,
  };
}

function renderTab(skill: Skill) {
  mockInventory.mockReturnValue({
    data: { repo_id: "r1", has_clone: true, count: ITEMS.length, items: ITEMS },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockPreview.mockReturnValue(idleQuery);
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Skill ContextTab", () => {
  it("toggling a document persists the full ordered set via the skill mutation", () => {
    renderTab(makeSkill(["specs/alpha.md"]));

    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // attach beta.md
    expect(mockMutate).toHaveBeenCalledWith(["specs/alpha.md", "docs/guide/beta.md"]);
  });

  it("drag-reorder emits the new full ordered set", () => {
    renderTab(makeSkill(["specs/alpha.md", "docs/guide/beta.md"]));

    const rowAlpha = screen.getByText("alpha.md").closest('[draggable="true"]')!;
    const rowBeta = screen.getByText("beta.md").closest('[draggable="true"]')!;

    fireEvent.dragStart(rowBeta);
    fireEvent.dragOver(rowAlpha);
    fireEvent.drop(rowAlpha);

    expect(mockMutate).toHaveBeenCalledWith(["docs/guide/beta.md", "specs/alpha.md"]);
  });

  it("footer token total updates on toggle (AC-14)", () => {
    renderTab(makeSkill(["specs/alpha.md"]));

    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // +50
    expect(screen.getByText("≈ 150 tokens")).toBeInTheDocument();
  });

  it('renders the read-only "serializes as" block with the attached paths and inherit hint', () => {
    renderTab(makeSkill(["specs/alpha.md", "docs/guide/beta.md"]));

    expect(screen.getByText("Serializes as")).toBeInTheDocument();
    const block = screen.getByText(/## Project specifications/);
    expect(block.textContent).toContain("- specs/alpha.md");
    expect(block.textContent).toContain("- docs/guide/beta.md");
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();
  });

  it("hides the serializes-as block when nothing is attached", () => {
    renderTab(makeSkill([]));
    expect(screen.queryByText("Serializes as")).not.toBeInTheDocument();
  });
});

describe("Skill ContextTab — filter and stale attached paths", () => {
  it("filter narrows rows by full-path substring (folders too) and clearing restores", () => {
    renderTab(makeSkill([]));

    const input = screen.getByPlaceholderText("Filter documents…");
    // "guide" only exists in beta's FOLDER path, not any file name
    fireEvent.change(input, { target: { value: "guide" } });
    expect(screen.getByText("beta.md")).toBeInTheDocument();
    expect(screen.queryByText("alpha.md")).not.toBeInTheDocument();

    // the attached counter reflects the full inventory, not the filtered view
    expect(screen.getByText("0 of 2 attached")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("alpha.md")).toBeInTheDocument();
  });

  it("keeps a stale attached path: no row, 0 tokens, still serialized and never dropped from persists", () => {
    renderTab(makeSkill(["specs/ghost.md", "specs/alpha.md"]));

    // the stale path renders no row and contributes 0 to the token total…
    expect(screen.queryByText("ghost.md")).not.toBeInTheDocument();
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();

    // …but it is still part of the attached set the skill serializes
    const block = screen.getByText(/## Project specifications/);
    expect(block.textContent).toContain("- specs/ghost.md");
    expect(block.textContent).toContain("- specs/alpha.md");

    // attaching another doc persists the FULL set with the stale path intact, in position
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // beta.md (rows: alpha, beta)
    expect(mockMutate).toHaveBeenCalledWith([
      "specs/ghost.md",
      "specs/alpha.md",
      "docs/guide/beta.md",
    ]);
  });
});
