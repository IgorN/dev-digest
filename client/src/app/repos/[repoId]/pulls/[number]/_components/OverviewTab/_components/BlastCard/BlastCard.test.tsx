/**
 * BlastCard — covers the three states IntentCard established (loading/empty/
 * populated) plus Blast-specific behavior: expandable per-symbol callers,
 * a caller click firing onJumpToCode(file, line) (the cross-tab jump this
 * card exists to trigger), and the degraded-index badge + explanation.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../../../messages/en/blast.json";

const mockUseBlast = vi.fn();
const mockMutate = vi.fn();
vi.mock("../../../../../../../../../lib/hooks/blast", () => ({
  useBlast: (...args: unknown[]) => mockUseBlast(...args),
  useRecomputeBlast: () => ({ mutate: mockMutate, isPending: false }),
}));

import { BlastCard } from "./BlastCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(onJumpToCode = vi.fn(), diffPaths: ReadonlySet<string> = new Set()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, blast: blastMessages }}>
      <BlastCard prId="pr1" diffPaths={diffPaths} onJumpToCode={onJumpToCode} />
    </NextIntlClientProvider>,
  );
}

describe("BlastCard", () => {
  it("shows the empty state with a recompute CTA when nothing has been computed yet", () => {
    mockUseBlast.mockReturnValue({ data: null, isLoading: false });
    renderCard();

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Recompute"));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("renders stats + summary, expands a symbol on click, and jumps to a caller's file:line", () => {
    mockUseBlast.mockReturnValue({
      data: {
        changed_symbols: [
          { name: "rateLimit", file: "src/lib/rate-limit.ts", kind: "function" },
          { name: "bucketKey", file: "src/lib/rate-limit.ts", kind: "function" },
        ],
        downstream: [
          {
            symbol: "rateLimit",
            callers: [{ name: "itemsHandler", file: "src/api/public/items.ts", line: 23 }],
            endpoints_affected: ["GET /api/public/items"],
            crons_affected: [],
          },
          {
            symbol: "bucketKey",
            callers: [{ name: "webhooksHandler", file: "src/api/public/webhooks.ts", line: 45 }],
            endpoints_affected: ["POST /api/public/webhooks"],
            crons_affected: ["reset-rate-buckets"],
          },
        ],
        summary: "Rate limiting now guards 2 public endpoints.",
        degraded: false,
        degraded_reason: null,
      },
      isLoading: false,
    });
    const onJump = vi.fn();
    // Only rate-limit.ts (the declaring file) is part of this PR's diff — the
    // callers themselves (items.ts, webhooks.ts) typically are not.
    renderCard(onJump, new Set(["src/lib/rate-limit.ts"]));

    // header stats: 2 symbols, 2 callers, 2 endpoints, 1 cron
    expect(screen.getByText("Rate limiting now guards 2 public endpoints.")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(3); // symbols, callers, endpoints stats
    expect(screen.getByText("cron/jobs")).toBeInTheDocument();

    // First symbol (rateLimit) defaults open — its caller + endpoint badge are visible immediately.
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    // Second symbol (bucketKey) starts collapsed — its caller is NOT in the DOM yet.
    expect(screen.queryByText("POST /api/public/webhooks")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("bucketKey"));
    expect(screen.getByText("POST /api/public/webhooks")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets")).toBeInTheDocument();

    const callerButton = screen.getByRole("button", { name: /webhooksHandler.*webhooks\.ts:45/ });
    // Not part of the diff -> the "opens elsewhere" affordance, not the in-app jump arrow.
    expect(callerButton).toHaveAttribute("title", expect.stringContaining("GitHub"));
    fireEvent.click(callerButton);
    expect(onJump).toHaveBeenCalledWith("src/api/public/webhooks.ts", 45);
  });

  it("shows a degraded badge + human-readable reason when built on a partial index", () => {
    mockUseBlast.mockReturnValue({
      data: {
        changed_symbols: [],
        downstream: [],
        summary: "No indexed symbols were declared in the changed files.",
        degraded: true,
        degraded_reason: "index_partial",
      },
      isLoading: false,
    });
    renderCard();

    expect(screen.getByText("Partial index")).toBeInTheDocument();
    expect(screen.getByText(/only partially built/i)).toBeInTheDocument();
  });

  it("shows the no-downstream message instead of an empty tree when symbols have zero callers", () => {
    mockUseBlast.mockReturnValue({
      data: {
        changed_symbols: [{ name: "helper", file: "src/lib/helper.ts", kind: "function" }],
        downstream: [
          { symbol: "helper", callers: [], endpoints_affected: [], crons_affected: [] },
        ],
        summary: "No callers of the changed symbol were found.",
        degraded: false,
        degraded_reason: null,
      },
      isLoading: false,
    });
    renderCard();

    expect(screen.getByText(/no downstream callers found/i)).toBeInTheDocument();
  });
});
