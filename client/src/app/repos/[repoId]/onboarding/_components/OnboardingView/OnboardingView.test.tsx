/**
 * OnboardingView — the per-repo Onboarding Tour leaf. Covers the three real user
 * flows: (AC-17) no tour → empty state whose Generate CTA triggers the recompute,
 * (AC-14) a degraded tour → honest badge + reason, and (AC-19) a persisted tour →
 * a header whose "files indexed" count and relative "last refreshed" time are
 * DERIVED from the payload (never fixed literals) plus rendered section Markdown.
 *
 * Mocks live at the hook / repo-context boundary (the component's own data
 * sources) — never the component itself. useParams is stubbed so the leaf
 * resolves its repoId. Follows the /context ProjectContextView test harness.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";

const mockUseOnboarding = vi.fn();
const mockMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: (...args: unknown[]) => mockUseOnboarding(...args),
  useRecomputeOnboarding: () => ({ mutate: mockMutate, isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// Avoid mermaid's lazy dynamic import under jsdom; the diagram render itself is
// not under test here.
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: () => null,
}));

import { OnboardingView } from "./OnboardingView";

function makeTour(over: Partial<Onboarding> = {}): Onboarding {
  return {
    sections: [
      {
        kind: "run-locally",
        title: "How to run locally",
        body: "# Getting started\n\nRun the dev script to boot the stack.",
        diagram: null,
        links: [],
      },
    ],
    generated_at: new Date().toISOString(),
    files_indexed: 0,
    index_state: "full",
    degraded_reason: null,
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <OnboardingView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingView", () => {
  it("AC-17: shows the empty state and issues a recompute when Generate is clicked", () => {
    mockUseOnboarding.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();

    // Explanatory empty state (a null tour is an expected state, not an error).
    expect(screen.getByText(/DevDigest indexes the repository/)).toBeInTheDocument();

    // The CTA is the only generation trigger — clicking it hits the mutation.
    expect(mockMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /generate onboarding tour/i }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("AC-14: renders the degraded badge and its reason when index_state is degraded", () => {
    const reason = "Only 3 of 200 files were indexed before the clone timed out.";
    mockUseOnboarding.mockReturnValue({
      data: makeTour({ index_state: "degraded", degraded_reason: reason }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();

    expect(screen.getByText("Index unavailable")).toBeInTheDocument();
    expect(screen.getByText("Why this tour is limited")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("AC-19: derives the files-indexed count and relative refresh time, and renders section Markdown", () => {
    // A count and a timestamp the component cannot possibly emit as a hardcoded
    // literal: 42 files, generated ~5 minutes ago → the helper must yield "5m ago".
    mockUseOnboarding.mockReturnValue({
      data: makeTour({
        files_indexed: 42,
        generated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();

    // Subtitle is built from files_indexed (42) and timeAgo(generated_at) ("5m ago").
    expect(screen.getByText(/42 files/)).toBeInTheDocument();
    expect(screen.getByText(/last refreshed 5m ago/)).toBeInTheDocument();

    // A full-index tour carries no degraded badge.
    expect(screen.queryByText("Index unavailable")).not.toBeInTheDocument();

    // Section body is rendered THROUGH Markdown (heading element), not raw source.
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.queryByText("# Getting started")).not.toBeInTheDocument();
    expect(screen.getByText("Run the dev script to boot the stack.")).toBeInTheDocument();
  });
});
