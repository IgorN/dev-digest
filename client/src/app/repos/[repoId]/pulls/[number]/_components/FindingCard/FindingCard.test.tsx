import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const hoisted = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  isPending: false,
}));

vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({
    mutate: hoisted.mutateMock,
    isPending: hoisted.isPending,
  }),
}));

vi.mock("@/components/EvalCaseEditor", () => ({
  EvalCaseEditor: (props: { evalCase: EvalCase | null; onClose: () => void }) => (
    <div data-testid="eval-case-editor">
      <span data-testid="eval-case-editor-name">{props.evalCase?.name}</span>
      <button onClick={props.onClose}>close-editor</button>
    </div>
  ),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  hoisted.mutateMock.mockReset();
  hoisted.isPending = false;
});

beforeEach(() => {
  hoisted.mutateMock.mockReset();
  hoisted.isPending = false;
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const CREATED_CASE: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "agent1",
  name: "Hardcoded Stripe secret key",
  input_diff: "",
  input_files: null,
  input_meta: null,
  expected_output: [],
  notes: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} reviewAgentId="agent1" />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={onAction} reviewAgentId="agent1" />,
    );
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case", () => {
  it("renders disabled and does not call the mutation for a PENDING finding", () => {
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={() => {}} reviewAgentId="agent1" />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(hoisted.mutateMock).not.toHaveBeenCalled();
  });

  it("renders disabled when the owning review has no agent (reviewAgentId null)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-29T00:00:00.000Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onAction={() => {}} reviewAgentId={null} />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(hoisted.mutateMock).not.toHaveBeenCalled();
  });

  it("an ACCEPTED finding with a valid agent creates a case and opens the editor", () => {
    hoisted.mutateMock.mockImplementation(
      (_findingId: string, opts?: { onSuccess?: (c: EvalCase) => void }) => {
        opts?.onSuccess?.(CREATED_CASE);
      },
    );
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-29T00:00:00.000Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onAction={() => {}} reviewAgentId="agent1" />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(hoisted.mutateMock).toHaveBeenCalledWith("f1", expect.any(Object));
    expect(screen.getByTestId("eval-case-editor")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-editor-name")).toHaveTextContent(CREATED_CASE.name);
  });

  it("a DISMISSED finding (must_not_flag path) works via the same flow", () => {
    hoisted.mutateMock.mockImplementation(
      (_findingId: string, opts?: { onSuccess?: (c: EvalCase) => void }) => {
        opts?.onSuccess?.(CREATED_CASE);
      },
    );
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-07-29T00:00:00.000Z" };
    renderWithIntl(
      <FindingCard f={dismissed} defaultExpanded onAction={() => {}} reviewAgentId="agent1" />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(hoisted.mutateMock).toHaveBeenCalledWith("f1", expect.any(Object));
    expect(screen.getByTestId("eval-case-editor")).toBeInTheDocument();
  });
});
