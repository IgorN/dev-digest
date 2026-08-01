/**
 * EvalCaseEditor — shared modal for creating/editing an eval case (L06).
 * Covers: valid -> invalid -> valid JSON toggling Save's disabled state
 * (AC-7); "Run on save" firing exactly one run-triggering request and the
 * status strip updating from that mutation's result without a remount
 * (AC-8); the four-fragment status strip rendering with a populated latest
 * run (AC-9); and the strip's total absence with zero runs (AC-10).
 *
 * Hooks are mocked at the `@/lib/hooks/eval` boundary (mirrors
 * EvalDashboardIndex.test.tsx). `fireEvent`, not `userEvent`, per this
 * project's convention (client/INSIGHTS.md, 2026-07-12). The Name/Diff/
 * Expected-output fields are all plain, unlabeled-by-`for` `<textarea>`/
 * `<input>` elements (this kit's `Textarea`/`TextInput` primitives don't
 * wire an `htmlFor`), so — matching this codebase's existing convention of
 * selecting `Checkbox`es by row order — they're selected by
 * `getAllByRole("textbox")` DOM order: [0] name, [1] diff (Diff tab is the
 * default active Input tab), [2] expected output.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRunBatchResponse, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";

const mockCreateMutateAsync = vi.fn();
const mockUpdateMutateAsync = vi.fn();
const mockRunMutateAsync = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCase: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useRunEvalBatch: () => ({ mutateAsync: mockRunMutateAsync, isPending: false }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: 'x'",
  input_files: ["src/config.ts"],
  input_meta: { title: "Add Stripe integration" },
  expected_output: [{ type: "must_find", file: "src/config.ts", start_line: 10 }],
  notes: null,
};

function renderEditor(over: Partial<React.ComponentProps<typeof EvalCaseEditor>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalCaseEditor
        agentId="agent-1"
        agentName="Security Reviewer"
        evalCase={CASE}
        onClose={vi.fn()}
        {...over}
      />
    </NextIntlClientProvider>,
  );
}

function expectedOutputTextarea() {
  const el = screen.getAllByRole("textbox")[2];
  if (!el) throw new Error("expected output textarea not found");
  return el;
}

describe("EvalCaseEditor", () => {
  it("toggles Save's disabled state as the expected_output JSON goes valid -> invalid -> valid", () => {
    renderEditor();
    const saveButton = screen.getByRole("button", { name: "Save" });

    // Loaded with a valid array already -> enabled.
    expect(saveButton).not.toBeDisabled();

    fireEvent.change(expectedOutputTextarea(), { target: { value: "{ not valid json" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(expectedOutputTextarea(), {
      target: { value: '[{"type":"must_find","file":"a.ts","start_line":1}]' },
    });
    expect(saveButton).not.toBeDisabled();
  });

  it('"Run on save" ON + Save fires exactly one run request and the strip updates without a remount', async () => {
    const savedCase: EvalCase = { ...CASE, name: "stripe-key-leak-renamed" };
    mockUpdateMutateAsync.mockResolvedValue(savedCase);
    const batchResponse: EvalRunBatchResponse = {
      run_batch_id: "batch-1",
      results: [
        {
          run_id: "run-1",
          case_id: CASE.id,
          result: {
            recall: 1,
            precision: 1,
            citation_accuracy: 1,
            traces_passed: 2,
            traces_total: 2,
            duration_ms: 1200,
            cost_usd: 0.01,
            // Realistic server shape (server/src/modules/eval/service.ts):
            // one `__produced_count__` marker PREPENDED, then one trace per
            // expectation item — `actual` is a single `Finding` object or
            // `null`, NEVER an array (the bug this fixture used to mask).
            per_trace: [
              { name: "__produced_count__", pass: true, expected: null, actual: { produced: 1 } },
              {
                name: "must_find src/config.ts:10",
                pass: true,
                expected: { type: "must_find", file: "src/config.ts", start_line: 10 },
                actual: { id: "f1", file: "src/config.ts", start_line: 10 },
              },
            ],
          },
        },
      ],
      dashboard: {
        owner_kind: "agent",
        owner_id: "agent-1",
        cases_total: 1,
        current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.01 },
        delta: { recall: 0, precision: 0, citation_accuracy: 0 },
        trend: [],
        recent_runs: [],
        alert: null,
      },
    };
    mockRunMutateAsync.mockResolvedValue(batchResponse);

    renderEditor();
    // "Run on save" defaults ON per the reference design.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockRunMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockRunMutateAsync).toHaveBeenCalledWith({ case_ids: [CASE.id] });

    // Strip reflects the fresh result — no remount, same render.
    await waitFor(() => expect(screen.getByText("Last run passed")).toBeInTheDocument());
    expect(screen.getByText(/expected 1 finding\(s\), got 1 · 1\.2s · \$0\.010/)).toBeInTheDocument();
  });

  it("renders all four status-strip fragments for a case with a populated latest run", () => {
    const latestRun: EvalRunRecord = {
      id: "run-1",
      case_id: CASE.id,
      case_name: CASE.name,
      ran_at: "2026-07-20T00:00:00.000Z",
      // Realistic shape: `EvalRunRecord.actual_output` is only ever populated
      // client-side (`toRunRecord`) from `per_trace[0]?.actual`, the
      // `__produced_count__` marker's own value — never a raw array of
      // finding-shaped objects (the bug this fixture used to mask).
      actual_output: { produced: 2 },
      pass: false,
      recall: 0.5,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 2500,
      cost_usd: 0.045,
    };
    renderEditor({ latestRun });

    expect(screen.getByText("Last run failed")).toBeInTheDocument();
    expect(screen.getByText(/expected 1 finding\(s\), got 2/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5s/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.045/)).toBeInTheDocument();
  });

  it("renders no status strip at all for a case with zero runs", () => {
    renderEditor({ latestRun: null });

    expect(screen.queryByText("Last run passed")).not.toBeInTheDocument();
    expect(screen.queryByText("Last run failed")).not.toBeInTheDocument();
    expect(screen.queryByText(/finding\(s\)/)).not.toBeInTheDocument();
  });
});
