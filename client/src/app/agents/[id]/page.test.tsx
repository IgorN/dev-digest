/**
 * /agents/:id — the tab triad regression guard (AC-54).
 *
 * A tab key is consumed in THREE places that must agree: `VALID_TABS` here in
 * `page.tsx`, the `TABS` array in `AgentEditor/constants.ts`, and the render
 * switch in `AgentEditor.tsx`. When one disagrees the `?tab=` value is rejected
 * and silently falls back to `config` — with NO compile error
 * (client/INSIGHTS.md, 2026-06-26). This test drives the page with `?tab=ci`
 * and asserts the CI tab actually renders, which is the only way that failure
 * mode is observable.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentsMessages from "../../../../messages/en/agents.json";
import ciMessages from "../../../../messages/en/ci.json";
import { ToastProvider } from "../../../lib/toast";

const hoisted = vi.hoisted(() => ({ tab: "ci" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "agent-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${hoisted.tab}`),
}));

vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets",
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  system_prompt: "You review PRs.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 2,
};

// `@/lib/hooks/agents` and `../../../lib/hooks/agents` resolve to the SAME
// module, so one factory must cover every export both importers use.
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
  useAgent: () => ({ data: AGENT, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/ci-export", () => ({
  useCiInstallations: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalDashboard: () => ({ data: undefined, isLoading: true }),
  useEvalCases: () => ({ data: undefined, isLoading: true }),
  useRunEvalBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AgentEditorPage from "./page";
import { TABS } from "./_components/AgentEditor/constants";

afterEach(cleanup);

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, ci: ciMessages }}>
      <ToastProvider>
        <AgentEditorPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("agent editor page — tab triad", () => {
  it("renders the CI tab (not the config fallback) for ?tab=ci, and places CI last in the bar", () => {
    hoisted.tab = "ci";
    renderPage();

    // The render switch mounted CITab, not the Config fallback.
    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();

    // ...and `ci` is the LAST entry of the visible tab bar.
    expect(TABS[TABS.length - 1]!.key).toBe("ci");
    expect(screen.getByText("CI")).toBeInTheDocument();
  });

  it("still falls back to the config tab for an unknown ?tab= value", () => {
    hoisted.tab = "not-a-tab";
    renderPage();

    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.queryByText("Not in CI yet")).not.toBeInTheDocument();
  });
});
