/**
 * hooks/ci-runs — the CI Runs read hook + the explicit Refresh mutation.
 * Mocked at the ONE I/O seam (`../api`), matching this codebase's
 * onboarding.test.tsx harness (msw is NOT installed).
 *
 * The load-bearing assertions here are the refresh SEMANTICS:
 *   - the list query re-reads the LOCAL table on a 30 s interval and does NOT
 *     run that interval in the background (the design's "auto-refresh on" is a
 *     local re-read, never a background GitHub poll);
 *   - the GitHub pull happens only through the explicit Refresh mutation, which
 *     invalidates ["ci-runs"] so every filtered page re-reads.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiIngestResult, CiRunsResponse } from "@devdigest/shared";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { CI_RUNS_REFETCH_MS, ciRunsQueryString, useCiRuns, useRefreshCiRuns } from "./ci-runs";

function makeResponse(over: Partial<CiRunsResponse> = {}): CiRunsResponse {
  return { runs: [], agents: [], repos: [], ...over };
}

function makeIngest(over: Partial<CiIngestResult> = {}): CiIngestResult {
  return { examined: 0, ingested: 0, skipped: 0, already_known: 0, failures: [], ...over };
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

describe("ciRunsQueryString", () => {
  it("omits unset filters entirely", () => {
    expect(ciRunsQueryString({})).toBe("");
    expect(ciRunsQueryString({ days: null, agent_id: null, repo: null })).toBe("");
  });

  it("serializes every active filter", () => {
    expect(
      ciRunsQueryString({ days: 7, agent_id: "a1", repo: "acme/api", status: "failed", source: "gha" }),
    ).toBe("?days=7&agent_id=a1&repo=acme%2Fapi&status=failed&source=gha");
  });
});

describe("useCiRuns", () => {
  it("GETs /ci-runs and returns the rows plus the chip facets in one round trip", async () => {
    mockGet.mockResolvedValue(makeResponse({ agents: [{ id: "a1", name: "Security" }], repos: ["acme/api"] }));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCiRuns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/ci-runs");
    expect(result.current.data?.agents).toEqual([{ id: "a1", name: "Security" }]);
    expect(result.current.data?.repos).toEqual(["acme/api"]);
  });

  it("appends the active filters to the request path", async () => {
    mockGet.mockResolvedValue(makeResponse());
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCiRuns({ days: 7, repo: "acme/api" }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/ci-runs?days=7&repo=acme%2Fapi");
  });

  it("re-reads the local table every 30s and does NOT run that interval in the background", async () => {
    mockGet.mockResolvedValue(makeResponse());
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useCiRuns(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: ["ci-runs", {}] });
    const options = query?.observers[0]?.options;
    expect(options?.refetchInterval).toBe(30_000);
    expect(CI_RUNS_REFETCH_MS).toBe(30_000);
    // A hidden tab must not keep polling the API.
    expect(options?.refetchIntervalInBackground).toBe(false);
  });
});

describe("useRefreshCiRuns", () => {
  it("POSTs /ci-runs/refresh, returns the ingest summary, and invalidates ['ci-runs']", async () => {
    mockPost.mockResolvedValue(makeIngest({ examined: 3, ingested: 2, failures: [{ github_run_id: "9", reason: "no artifact" }] }));
    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRefreshCiRuns(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith("/ci-runs/refresh");
    expect(result.current.data?.ingested).toBe(2);
    expect(result.current.data?.failures).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ci-runs"] });
  });
});
