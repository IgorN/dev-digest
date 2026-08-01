/**
 * hooks/eval — the eval-case CRUD + run-batch + dashboard React Query hooks.
 * Mocked at the ONE I/O seam (`../api`), same harness as onboarding.test.tsx:
 * no real network (msw is not installed), no jsdom fetch — only the `api`
 * client is stubbed. Covers a successful list fetch (useEvalCases) and the
 * run-batch mutation's cache writes (useRunEvalBatch).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCase, EvalRunBatchResponse } from "@devdigest/shared";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDel = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    del: (...args: unknown[]) => mockDel(...args),
  },
}));

import {
  useEvalCases,
  useUpdateEvalCase,
  useRunEvalBatch,
  useAgentEvalDashboard,
} from "./eval";

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "Missing null check",
    input_diff: "diff --git a/x.ts b/x.ts\n",
    input_files: null,
    input_meta: null,
    expected_output: [{ type: "must_find", file: "x.ts", start_line: 1 }],
    notes: null,
    ...over,
  };
}

function makeDashboard(over: Partial<EvalRunBatchResponse["dashboard"]> = {}) {
  return {
    owner_kind: "agent" as const,
    owner_id: "agent-1",
    cases_total: 1,
    current: {
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 1,
      traces_total: 1,
      cost_usd: 0.01,
    },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
    ...over,
  };
}

function makeBatchResponse(over: Partial<EvalRunBatchResponse> = {}): EvalRunBatchResponse {
  return {
    run_batch_id: "batch-1",
    results: [
      {
        run_id: "run-1",
        case_id: "case-1",
        result: {
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          traces_passed: 1,
          traces_total: 1,
          duration_ms: 120,
          cost_usd: 0.01,
          per_trace: [],
        },
      },
    ],
    dashboard: makeDashboard(),
    ...over,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useEvalCases", () => {
  it("GETs /agents/:id/eval-cases and populates the cache", async () => {
    const cases = [makeCase(), makeCase({ id: "case-2", name: "Second case" })];
    mockGet.mockResolvedValue(cases);
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalCases("agent-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/agents/agent-1/eval-cases");
    expect(result.current.data).toEqual(cases);
    expect(queryClient.getQueryData(["eval-cases", "agent-1"])).toEqual(cases);
  });

  it("is gated on agentId — no fetch when agentId is falsy", () => {
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalCases(null), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useUpdateEvalCase", () => {
  it("PUTs /eval-cases/:id with the run_on_save flag and seeds both caches", async () => {
    const updated = makeCase({ name: "Renamed case" });
    mockPut.mockResolvedValue(updated);
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useUpdateEvalCase("case-1"), { wrapper });

    result.current.mutate({ name: "Renamed case", run_on_save: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith("/eval-cases/case-1", {
      name: "Renamed case",
      run_on_save: true,
    });
    expect(queryClient.getQueryData(["eval-case", "case-1"])).toEqual(updated);
  });
});

describe("useRunEvalBatch", () => {
  it("POSTs /agents/:id/eval-runs and seeds the dashboard cache + invalidates case/workspace caches", async () => {
    const response = makeBatchResponse();
    mockPost.mockResolvedValue(response);
    const { queryClient, wrapper } = makeWrapper();

    // Pre-seed caches this mutation is expected to touch, so we can observe
    // the seed (dashboard) vs the invalidation (eval-cases/eval-dashboard).
    queryClient.setQueryData(["agent-eval-dashboard", "agent-1"], makeDashboard({ cases_total: 0 }));
    queryClient.setQueryData(["eval-cases", "agent-1"], []);
    queryClient.setQueryData(["eval-dashboard"], { agents: [], recent_runs: [] });

    const { result } = renderHook(() => useRunEvalBatch("agent-1"), { wrapper });

    result.current.mutate({ case_ids: ["case-1"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith("/agents/agent-1/eval-runs", { case_ids: ["case-1"] });

    // Fresh dashboard is written straight into the cache (parent record).
    expect(queryClient.getQueryData(["agent-eval-dashboard", "agent-1"])).toEqual(
      response.dashboard,
    );

    // Case list + workspace dashboard aren't part of the response — they're
    // invalidated (stale) rather than seeded.
    expect(
      queryClient.getQueryState(["eval-cases", "agent-1"])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["eval-dashboard"])?.isInvalidated).toBe(true);
  });
});

describe("useAgentEvalDashboard", () => {
  it("GETs /agents/:id/eval-dashboard", async () => {
    const dashboard = makeDashboard();
    mockGet.mockResolvedValue(dashboard);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAgentEvalDashboard("agent-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/agents/agent-1/eval-dashboard");
    expect(result.current.data).toEqual(dashboard);
  });
});
