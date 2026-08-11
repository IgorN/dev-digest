/**
 * hooks/multi-runs — the Multi-Agent Review read hooks. Mocked at the ONE I/O
 * seam (`../api`), like `onboarding.test.tsx`; msw is not installed.
 *
 * What matters here is the polling contract (AC-37/AC-38: refresh while any
 * lane runs, stop dead once they all settle) and the "no multi-run yet" answer
 * being a SUCCESS with `multi_run: null`, never an error (AC-22b).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LatestMultiRunResponse, MultiRunDocument } from "@devdigest/shared";

const mockGet = vi.fn();

vi.mock("../api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}));

import {
  multiRunRefetchInterval,
  isTerminalRunStatus,
  useLatestMultiRun,
  useMultiRun,
  MULTI_RUN_POLL_MS,
} from "./multi-runs";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function doc(statuses: string[]): MultiRunDocument {
  return {
    id: "mr1",
    ran_at: new Date().toISOString(),
    pr: { id: "pr1", number: 1, title: "feat(notes): add notes search and create" },
    agents: statuses.map((status, i) => ({
      agent_id: `a${i}`,
      agent_name: `Agent ${i}`,
      run_id: `r${i}`,
      status,
      duration_ms: 1000,
      cost_usd: 0.01,
      score: 70,
      summary: null,
      findings: [],
    })),
    groups: [],
    totals: { max_duration_ms: 1000, total_cost_usd: 0.01, agent_count: statuses.length },
  };
}

afterEach(() => {
  cleanup();
  mockGet.mockReset();
});

describe("multiRunRefetchInterval", () => {
  it("polls while a document has not loaded yet", () => {
    expect(multiRunRefetchInterval(undefined)).toBe(MULTI_RUN_POLL_MS);
  });

  it("polls while ANY lane is still running (AC-37)", () => {
    expect(multiRunRefetchInterval(doc(["done", "running", "done"]))).toBe(MULTI_RUN_POLL_MS);
  });

  it("stops once every lane is terminal (AC-38)", () => {
    expect(multiRunRefetchInterval(doc(["done", "failed", "cancelled"]))).toBe(false);
  });

  it("treats an agent-less document as settled", () => {
    expect(multiRunRefetchInterval(doc([]))).toBe(false);
  });
});

describe("isTerminalRunStatus", () => {
  it.each(["done", "failed", "cancelled"])("%s is terminal", (s) => {
    expect(isTerminalRunStatus(s)).toBe(true);
  });

  it.each(["running", "queued", null, undefined, ""])("%s is not terminal", (s) => {
    expect(isTerminalRunStatus(s as string | null | undefined)).toBe(false);
  });
});

describe("useMultiRun", () => {
  it("requests the document by id", async () => {
    mockGet.mockResolvedValue(doc(["done"]));
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/multi-runs/mr1");
  });

  it("is disabled without an id", () => {
    renderHook(() => useMultiRun(null), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useLatestMultiRun", () => {
  it("surfaces an empty scope as SUCCESS with multi_run null, not an error (AC-22b)", async () => {
    const empty: LatestMultiRunResponse = { multi_run: null };
    mockGet.mockResolvedValue(empty);
    const { result } = renderHook(() => useLatestMultiRun({ repoId: "repo1" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data?.multi_run).toBeNull();
    expect(mockGet).toHaveBeenCalledWith("/multi-runs/latest?repoId=repo1");
  });

  it("scopes by PR when given a prId", async () => {
    mockGet.mockResolvedValue({ multi_run: null } satisfies LatestMultiRunResponse);
    const { result } = renderHook(() => useLatestMultiRun({ prId: "pr1" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/multi-runs/latest?prId=pr1");
  });

  it("stays disabled when neither or both scope values are given", () => {
    renderHook(() => useLatestMultiRun({}), { wrapper });
    renderHook(() => useLatestMultiRun({ repoId: "repo1", prId: "pr1" }), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
