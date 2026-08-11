/**
 * PrBriefCard — the Why + Risk Brief card. Covers the states IntentCard/
 * BlastCard established (empty + recompute CTA, populated, degraded) plus
 * this card's own surface: all five AC-14 regions render together, the
 * risk-level indicator always carries a text label (never colour alone,
 * AC-15), a review_focus row is an actionable control that jumps to
 * (file, line) — defaulting to line 1 when the model didn't supply one
 * (AC-16) — a degraded brief still renders its available content, never a
 * blank state (AC-18) — and a recompute in flight is a non-duplicable
 * pending state (AC-17).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { WhyRiskBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";

const mockUseWhyRiskBrief = vi.fn();
const mockUseRecomputeWhyRiskBrief = vi.fn();
const mockMutate = vi.fn();
vi.mock("../../../../../../../../../lib/hooks/why-risk-brief", () => ({
  useWhyRiskBrief: (...args: unknown[]) => mockUseWhyRiskBrief(...args),
  useRecomputeWhyRiskBrief: (...args: unknown[]) => mockUseRecomputeWhyRiskBrief(...args),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeBrief(over: Partial<WhyRiskBrief> = {}): WhyRiskBrief {
  return {
    what: "Adds per-endpoint rate limiting to the public API.",
    why: "Recent abuse reports showed unauthenticated clients hammering /items.",
    risk_level: "high",
    risks: [
      {
        kind: "correctness",
        title: "Rate limit bucket key collides across tenants",
        explanation: "The bucket key omits the tenant id, so two tenants could share a limit.",
        severity: "high",
        file_refs: ["src/lib/rate-limit.ts"],
      },
    ],
    review_focus: [
      { file: "src/lib/rate-limit.ts", line: 42, reason: "Bucket key derivation lives here." },
      { file: "src/api/public/items.ts", reason: "Caller wiring — no line supplied by the model." },
    ],
    degraded: false,
    degraded_reason: null,
    ...over,
  };
}

function renderCard(onJumpToCode = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <PrBriefCard prId="pr1" diffPaths={new Set()} onJumpToCode={onJumpToCode} />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("shows the empty state with a recompute CTA when no brief has been computed yet", () => {
    mockUseWhyRiskBrief.mockReturnValue({ data: null, isLoading: false });
    mockUseRecomputeWhyRiskBrief.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderCard();

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Recompute"));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("renders all five brief regions and jumps to a review-focus item's file:line, defaulting to line 1 when the model omitted one", () => {
    const brief = makeBrief();
    mockUseWhyRiskBrief.mockReturnValue({ data: brief, isLoading: false });
    mockUseRecomputeWhyRiskBrief.mockReturnValue({ mutate: mockMutate, isPending: false });
    const onJump = vi.fn();
    renderCard(onJump);

    // what / why — two distinct, separately-queryable regions.
    expect(screen.getByText(brief.what)).toBeInTheDocument();
    expect(screen.getByText(brief.why)).toBeInTheDocument();

    // Risk-level indicator: assert the visible TEXT label, not just a
    // colour/class — colour alone must never be the only signal (AC-15).
    expect(screen.getByText("High risk")).toBeInTheDocument();

    // At least one risk row's title.
    expect(screen.getByText(brief.risks[0]!.title)).toBeInTheDocument();

    // At least one review_focus row's file:line text.
    expect(screen.getByText("src/lib/rate-limit.ts:42")).toBeInTheDocument();

    // Clicking a review_focus row invokes onJumpToCode with its exact (file, line).
    fireEvent.click(screen.getByRole("button", { name: "src/lib/rate-limit.ts:42" }));
    expect(onJump).toHaveBeenCalledWith("src/lib/rate-limit.ts", 42);

    // A fixture item with no line defaults to line 1 (the default lives on the client).
    fireEvent.click(screen.getByRole("button", { name: "src/api/public/items.ts" }));
    expect(onJump).toHaveBeenCalledWith("src/api/public/items.ts", 1);
  });

  it("shows the cost/tokens badge when cost_usd is present (AD-4), and omits it for a brief without one", () => {
    const withCost = makeBrief({ tokens_in: 8200, tokens_out: 1300, cost_usd: 0.014 });
    mockUseWhyRiskBrief.mockReturnValue({ data: withCost, isLoading: false });
    mockUseRecomputeWhyRiskBrief.mockReturnValue({ mutate: mockMutate, isPending: false });
    const { unmount } = renderCard();
    expect(screen.getByText("$0.014 · 8.2K→1.3K")).toBeInTheDocument();
    unmount();

    // A brief persisted before AD-4 (or a degraded skeleton) has no cost_usd
    // at all — the badge must not render a bare "—" in its place.
    mockUseWhyRiskBrief.mockReturnValue({ data: makeBrief(), isLoading: false });
    renderCard();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("renders the degraded badge and reason alongside the rest of the content, never a blank state", () => {
    const brief = makeBrief({
      risk_level: "medium",
      risks: [],
      review_focus: [],
      degraded: true,
      degraded_reason:
        "The risk brief could not be generated; showing a deterministic best-effort summary.",
    });
    mockUseWhyRiskBrief.mockReturnValue({ data: brief, isLoading: false });
    mockUseRecomputeWhyRiskBrief.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderCard();

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText(brief.degraded_reason!)).toBeInTheDocument();
    // The rest of the content still renders — never a blank error state.
    expect(screen.getByText(brief.what)).toBeInTheDocument();
    expect(screen.getByText(brief.why)).toBeInTheDocument();
    expect(screen.getByText("Medium risk")).toBeInTheDocument();
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(screen.getByText("No specific files flagged for review.")).toBeInTheDocument();
  });

  it("shows a non-duplicable recomputing state while a recompute is in flight", () => {
    mockUseWhyRiskBrief.mockReturnValue({ data: makeBrief(), isLoading: false });
    mockUseRecomputeWhyRiskBrief.mockReturnValue({ mutate: mockMutate, isPending: true });
    renderCard();

    const button = screen.getByRole("button", { name: "Recomputing…" });
    expect(button).toBeDisabled();
    expect(screen.queryByText("Recompute")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
