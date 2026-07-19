/**
 * hooks/onboarding — the read + recompute React Query hooks. Mocked at the ONE
 * I/O seam (`../api`), so these assert the hook's own contract: the request path,
 * the `{ onboarding }` envelope unwrap (populated AND null), the `enabled` gate on
 * repoId, and that a successful recompute writes the unwrapped tour into the
 * ["onboarding", repoId] cache. No real network (msw is not installed), no jsdom
 * fetch — only the `api` client is stubbed.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Onboarding } from "@devdigest/shared";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useOnboarding, useRecomputeOnboarding } from "./onboarding";

function makeTour(over: Partial<Onboarding> = {}): Onboarding {
  return {
    sections: [
      { kind: "run-locally", title: "Run locally", body: "boot it", diagram: null, links: [] },
    ],
    generated_at: new Date().toISOString(),
    files_indexed: 7,
    index_state: "full",
    degraded_reason: null,
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

describe("useOnboarding", () => {
  it("GETs /repos/:id/onboarding and unwraps the { onboarding } envelope to a populated tour", async () => {
    const tour = makeTour();
    mockGet.mockResolvedValue({ onboarding: tour });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboarding("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/repos/r1/onboarding");
    expect(result.current.data).toEqual(tour);
  });

  it("unwraps a null tour (200 + { onboarding: null }) to null, not an error", async () => {
    mockGet.mockResolvedValue({ onboarding: null });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboarding("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("is gated on repoId — no fetch when repoId is falsy", async () => {
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboarding(null), { wrapper });

    // Disabled query never enters fetching; the api seam is never touched.
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useRecomputeOnboarding", () => {
  it("POSTs /repos/:id/onboarding/recompute and writes the unwrapped tour into the cache", async () => {
    const tour = makeTour({ files_indexed: 128 });
    mockPost.mockResolvedValue({ onboarding: tour });
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useRecomputeOnboarding("r1"), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith("/repos/r1/onboarding/recompute", {});
    // onSuccess seeds ["onboarding", "r1"] with the unwrapped payload.
    expect(queryClient.getQueryData(["onboarding", "r1"])).toEqual(tour);
  });
});
