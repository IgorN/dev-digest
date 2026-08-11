/**
 * hooks/ci-export — the Export-to-CI query hooks. Mocked at the ONE I/O seam
 * (`../api`), so these assert the hooks' own contract: the request paths, the
 * `action` discriminator that separates "generate" from "install" on the SAME
 * route, the cache invalidation an install must perform, and the zip hook's
 * "one blob call and nothing else" guarantee (AC-78).
 *
 * msw is not installed in this project (client/INSIGHTS.md, 2026-07-18) — the
 * `api` client is the stub boundary.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiExport, CiInstallation } from "@devdigest/shared";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockBlob = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    blob: (...args: unknown[]) => mockBlob(...args),
  },
}));

import {
  useCiInstallations,
  useGenerateCiExport,
  useInstallCiExport,
  useDownloadCiZip,
} from "./ci-export";

const INSTALLATION: CiInstallation = {
  id: "inst-1",
  agent_id: "agent-1",
  workspace_id: "ws-1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2026-08-01T10:00:00.000Z",
  post_as: "github_review",
  triggers: ["opened", "synchronize"],
  base: "main",
  manifest_path: ".devdigest/agents/security-reviewer.yaml",
  workflow_path: ".github/workflows/devdigest-review.yml",
  workflow_version: 2,
  pr_url: "https://github.com/acme/payments-api/pull/9",
  last_ingest_at: null,
  exported_ci_fail_on: "critical",
  status: null,
  last_activity_at: null,
  policy_drift: false,
};

const EXPORT: CiExport = {
  installation: INSTALLATION,
  files: [],
  pr_url: "https://github.com/acme/payments-api/pull/9",
  repo: "acme/payments-api",
  file_count: 6,
};

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

describe("useCiInstallations", () => {
  it("GETs the agent's installations and stays disabled without an agent id", async () => {
    mockGet.mockResolvedValue([INSTALLATION]);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCiInstallations("agent-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/agents/agent-1/ci-installations");
    expect(result.current.data).toEqual([INSTALLATION]);

    mockGet.mockClear();
    const { wrapper: w2 } = makeWrapper();
    renderHook(() => useCiInstallations(null), { wrapper: w2 });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("the export mutations", () => {
  it("generate posts action:'files' and install posts action:'open_pr' to the SAME route", async () => {
    mockPost.mockResolvedValue(EXPORT);
    const { wrapper } = makeWrapper();

    const gen = renderHook(() => useGenerateCiExport(), { wrapper });
    gen.result.current.mutate({ agentId: "agent-1", input: { repo: "acme/payments-api" } });
    await waitFor(() => expect(gen.result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith("/agents/agent-1/export-ci", {
      repo: "acme/payments-api",
      action: "files",
    });

    const install = renderHook(() => useInstallCiExport(), { wrapper });
    install.result.current.mutate({ agentId: "agent-1", input: { repo: "acme/payments-api" } });
    await waitFor(() => expect(install.result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenLastCalledWith("/agents/agent-1/export-ci", {
      repo: "acme/payments-api",
      action: "open_pr",
    });
  });

  it("a successful install invalidates the agent's installations AND the CI runs list", async () => {
    mockPost.mockResolvedValue(EXPORT);
    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useInstallCiExport(), { wrapper });
    result.current.mutate({ agentId: "agent-1", input: { repo: "acme/payments-api" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ci-installations", "agent-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ci-runs"] });
  });
});

describe("useDownloadCiZip", () => {
  it("calls api.blob exactly once and issues no other request (AC-78)", async () => {
    mockBlob.mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useDownloadCiZip(), { wrapper });
    result.current.mutate({ agentId: "agent-1", input: { repo: "acme/payments-api" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockBlob).toHaveBeenCalledTimes(1);
    expect(mockBlob).toHaveBeenCalledWith("/agents/agent-1/export-ci/zip", {
      repo: "acme/payments-api",
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });
});
