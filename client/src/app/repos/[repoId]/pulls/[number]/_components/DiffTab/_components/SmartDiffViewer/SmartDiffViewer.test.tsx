/**
 * SmartDiffViewer — the Files-changed tab's default risk-grouped view.
 * Covers the plan's three graded client behaviors:
 *  - the boilerplate section is collapsed by default (its file/content is
 *    NOT in the DOM until the section is toggled open),
 *  - a file with finding_lines shows a correctly-counted "N finding-lines"
 *    badge, and a zero-finding file shows none,
 *  - clicking that badge expands the file (if needed) and highlights the
 *    EXACT target line (finding_lines[0]), not just "the file".
 *
 * Click-to-line mechanism note: jsdom 25 (this project's version, verified
 * directly — HTMLElement.prototype.scrollIntoView is undefined, and
 * client/src/test/setup.ts has no polyfill for it) doesn't implement
 * scrollIntoView. FileCard optional-chains the call
 * (`el?.scrollIntoView?.(...)`), so it's a silent no-op under test rather
 * than a crash — see FileCard.tsx. Asserting the scroll itself is therefore
 * not possible here; instead this test asserts the observable proxy the plan
 * calls out as sufficient: the highlight style landing on the correct line's
 * DOM node (found via the SAME diffLineElementId(path, line) anchor the
 * component itself uses), which needs no scrollIntoView mock. Verified
 * empirically that jsdom's CSSOM round-trips `var(--accent-bg)` /
 * `var(--accent)` through element.style.background / .boxShadow losslessly
 * (a plain jsdom smoke check), so asserting on those two inline style
 * properties directly is reliable here.
 */
import type { ComponentProps } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@/lib/types";
import { diffLineElementId } from "@/components/diff-viewer/helpers";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

// "src/services/payment.ts" (core, 2 findings on its two added lines):
//   hunk @@ -1,2 +1,3 @@ -> newNo starts at 1
//     ctx  " const base = 1;"          newNo=1 -> 2
//     del  "-const old = 1;"
//     add  "+const chargeAmount = 42;" newNo=2 -> 3   (finding_lines[0])
//     add  "+const extra = true;"      newNo=3 -> 4   (finding_lines[1])
const PAYMENT_PATCH = [
  "@@ -1,2 +1,3 @@",
  " const base = 1;",
  "-const old = 1;",
  "+const chargeAmount = 42;",
  "+const extra = true;",
].join("\n");

const TSCONFIG_PATCH = ["@@ -1,1 +1,2 @@", " {", '+  "strict": true'].join("\n");

const LOCKFILE_PATCH = [
  "@@ -1,1 +1,2 @@",
  " lockfileVersion: '6.0'",
  "+  totallyUniqueLockfileMarkerXYZ: true",
].join("\n");

const FILES: PrFile[] = [
  { path: "src/services/payment.ts", additions: 2, deletions: 1, patch: PAYMENT_PATCH },
  { path: "tsconfig.json", additions: 1, deletions: 0, patch: TSCONFIG_PATCH },
  { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: LOCKFILE_PATCH },
];

const DATA: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [{ path: "src/services/payment.ts", additions: 2, deletions: 1, finding_lines: [2, 3] }],
    },
    {
      role: "wiring",
      files: [{ path: "tsconfig.json", additions: 1, deletions: 0, finding_lines: [] }],
    },
    {
      role: "boilerplate",
      files: [{ path: "pnpm-lock.yaml", additions: 1, deletions: 0, finding_lines: [] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

function renderViewer(extra?: Partial<ComponentProps<typeof SmartDiffViewer>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, prReview: prReviewMessages }}>
      <SmartDiffViewer data={DATA} files={FILES} reviews={[]} {...extra} />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("keeps the boilerplate section collapsed by default, and reveals its file content once toggled open", () => {
    renderViewer();

    // core + wiring render immediately (not collapsible)…
    expect(screen.getByText("src/services/payment.ts")).toBeInTheDocument();
    expect(screen.getByText("tsconfig.json")).toBeInTheDocument();

    // …but the boilerplate group's file — and its patch content — is not in
    // the DOM at all yet, not merely visually hidden.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    expect(screen.queryByText(/totallyUniqueLockfileMarkerXYZ/)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Boilerplate/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.getByText(/totallyUniqueLockfileMarkerXYZ/)).toBeInTheDocument();
  });

  it("badges only the file with findings (correctly counted), and clicking it highlights the exact target line", () => {
    renderViewer();

    // Exactly one "N finding-lines" badge exists — the clean tsconfig.json
    // file gets none (acceptance criterion: "zero-finding files show none").
    const badges = screen.getAllByText("2 finding-lines");
    expect(badges).toHaveLength(1);
    const badge = screen.getByRole("button", { name: "2 finding-lines" });

    const targetRow = screen.getByText("const chargeAmount = 42;").parentElement as HTMLElement;
    const siblingRow = screen.getByText("const extra = true;").parentElement as HTMLElement;

    // Baseline: this file auto-expands (tiny diff), so both added lines are
    // already rendered, but neither carries the highlight yet.
    expect(targetRow.style.boxShadow).toBe("");
    expect(siblingRow.style.boxShadow).toBe("");
    expect(targetRow.style.background).toBe("var(--code-add)");

    fireEvent.click(badge);

    // The row is literally the node the component looks up via
    // diffLineElementId(path, finding_lines[0]) — ties the assertion to the
    // real anchor mechanism, not incidental text matching.
    expect(targetRow.parentElement).toBe(
      document.getElementById(diffLineElementId("src/services/payment.ts", 2)),
    );

    // finding_lines[0] (line 2) is highlighted…
    expect(targetRow.style.background).toBe("var(--accent-bg)");
    expect(targetRow.style.boxShadow).toContain("var(--accent)");
    // …but its sibling add-line (line 3 — also in finding_lines, just not
    // [0]) is untouched: the click targeted the SPECIFIC line, not the file.
    expect(siblingRow.style.boxShadow).toBe("");
    expect(siblingRow.style.background).toBe("var(--code-add)");
  });

  it("adopts an external jump target (Blast Radius caller click) into the same highlight mechanism, opening the boilerplate section if needed", () => {
    const { rerender } = renderViewer({ targetPath: undefined, targetLine: undefined, targetNonce: 0 });

    // pnpm-lock.yaml lives in the collapsed-by-default boilerplate group.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, prReview: prReviewMessages }}>
        <SmartDiffViewer
          data={DATA}
          files={FILES}
          reviews={[]}
          targetPath="pnpm-lock.yaml"
          targetLine={2}
          targetNonce={1}
        />
      </NextIntlClientProvider>,
    );

    // The section auto-opened, the file is now rendered, and the exact line
    // is highlighted via the SAME diffLineElementId anchor as a click-driven jump.
    const targetRow = screen.getByText(/totallyUniqueLockfileMarkerXYZ/).parentElement as HTMLElement;
    expect(targetRow.parentElement).toBe(document.getElementById(diffLineElementId("pnpm-lock.yaml", 2)));
    expect(targetRow.style.background).toBe("var(--accent-bg)");
  });
});
