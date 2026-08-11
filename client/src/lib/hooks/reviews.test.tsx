/**
 * hooks/reviews — `useRunReview`'s request-body construction.
 *
 * The picker (multi-agent) and the two legacy paths (one agent / all enabled)
 * share one mutation, and the server resolves them by precedence
 * `agentIds` → `agentId` → `all`. What matters here is that each caller's key
 * reaches the body and the others stay ABSENT — an empty `agentIds: []` leaking
 * into the body would look like "multi-agent launch with no agents" to the
 * server. Mocked at the single `../api` seam, like `onboarding.test.tsx`.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPost = vi.fn();

vi.mock("../api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  API_BASE: "http://localhost:3001",
}));

vi.mock("../toast", () => ({ notify: { error: vi.fn() } }));

import { useRunReview } from "./reviews";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  mockPost.mockReset();
});

async function run(input: Parameters<ReturnType<typeof useRunReview>["mutateAsync"]>[0]) {
  mockPost.mockResolvedValue({ pr_id: "pr1", runs: [], reviews: [], multi_run_id: "mr1" });
  const { result } = renderHook(() => useRunReview(), { wrapper });
  await result.current.mutateAsync(input);
  await waitFor(() => expect(mockPost).toHaveBeenCalled());
  return mockPost.mock.calls[0] as [string, Record<string, unknown>];
}

describe("useRunReview body construction", () => {
  it("sends agentIds when supplied, and nothing else", async () => {
    const [path, body] = await run({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(path).toBe("/pulls/pr1/review");
    expect(body).toEqual({ agentIds: ["a1", "a2"] });
    expect(body).not.toHaveProperty("agentId");
    expect(body).not.toHaveProperty("all");
  });

  it("omits agentIds entirely when it is an empty array", async () => {
    const [, body] = await run({ prId: "pr1", agentIds: [], all: true });
    expect(body).not.toHaveProperty("agentIds");
    expect(body).toEqual({ all: true });
  });

  it("omits agentIds when it is not supplied at all (legacy single-agent path)", async () => {
    const [, body] = await run({ prId: "pr1", agentId: "a1" });
    expect(body).toEqual({ agentId: "a1" });
    expect(body).not.toHaveProperty("agentIds");
  });

  it("omits agentIds on the legacy run-all path", async () => {
    const [, body] = await run({ prId: "pr1", all: true });
    expect(body).toEqual({ all: true });
    expect(body).not.toHaveProperty("agentIds");
  });

  it("sends every supplied key so the server applies its own precedence", async () => {
    const [, body] = await run({ prId: "pr1", agentIds: ["a1"], agentId: "a2", all: true });
    expect(body).toEqual({ agentIds: ["a1"], agentId: "a2", all: true });
  });
});
