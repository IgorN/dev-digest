import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// The Evals tab's own hooks/child editor are covered by EvalsTab.test.tsx —
// here we only need the render-switch (`?tab=evals` -> EvalsTab) to not
// throw, regression-checking the three-file tab-wiring convention
// (VALID_TABS in page.tsx, TABS in constants.ts, this render switch).
vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalDashboard: () => ({ data: undefined, isLoading: true }),
  useEvalCases: () => ({ data: undefined, isLoading: true }),
  useRunEvalBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, eval: evalMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the Evals tab (regression check for the VALID_TABS/TABS/render-switch three-file wiring)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    // The tab bar itself (constants.ts's TABS) shows the "Evals" label...
    expect(screen.getByText("Evals")).toBeInTheDocument();
    // ...and the render switch actually mounts EvalsTab, not the Config
    // fallback (would show "Configuration" instead).
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.getByText("Eval metrics")).toBeInTheDocument();
  });
});
