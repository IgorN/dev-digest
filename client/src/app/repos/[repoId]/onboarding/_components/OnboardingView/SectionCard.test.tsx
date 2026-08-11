/**
 * SectionCard — the `run-locally` command-row precedence. The rows are the whole
 * point of that section (numbered, copyable), and they now have TWO possible
 * sources: the structured `commands` contract field (what the server emits now)
 * and the legacy first-fenced-code-block parse of the Markdown body (what
 * already-persisted tours carry). Both must render rows, structured wins, and a
 * section with neither signal must still degrade to plain Markdown.
 *
 * `commands` is deliberately asserted to be IGNORED on other kinds: the server
 * nulls it there, but the client must not depend on that.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";

// mermaid lazily dynamic-imports under jsdom; no diagram is under test here.
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: () => null,
}));

import { SectionCard } from "./SectionCard";

function makeSection(over: Partial<OnboardingSection> = {}): OnboardingSection {
  return {
    kind: "run-locally",
    title: "How to run locally",
    body: "Boot the stack in three steps.",
    diagram: null,
    commands: null,
    links: [],
    ...over,
  };
}

function renderSection(section: OnboardingSection) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <SectionCard section={section} repo={null} />
    </NextIntlClientProvider>,
  );
}

/** A command row is a `<code>` next to its own copy button. */
function commandTexts(): string[] {
  return screen
    .getAllByRole("button", { name: /copy command/i })
    .map((btn) => btn.parentElement?.querySelector("code")?.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SectionCard — run-locally command source", () => {
  it("renders copyable rows from the structured `commands` field, not from the body", () => {
    renderSection(
      makeSection({
        // The body carries narration AND a stale code block: the structured
        // field must win, so `pnpm ignored` must never reach the rows.
        body: "Boot the stack in three steps.\n\n```sh\npnpm ignored\n```",
        commands: ["./scripts/dev.sh", "cd server && pnpm dev"],
      }),
    );

    // The stale block still renders inside the Markdown body (the body is shown
    // verbatim) — what matters is that it never becomes a copyable ROW.
    expect(commandTexts()).toEqual(["./scripts/dev.sh", "cd server && pnpm dev"]);
    expect(commandTexts()).not.toContain("pnpm ignored");

    // Numbered rows, narration rendered as Markdown above them.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Boot the stack in three steps.")).toBeInTheDocument();
  });

  it("falls back to the legacy fenced code block when `commands` is absent", () => {
    renderSection(
      makeSection({
        body: "Boot the stack.\n\n```sh\ndocker compose up -d\npnpm db:migrate\n```",
        commands: null,
      }),
    );

    expect(commandTexts()).toEqual(["docker compose up -d", "pnpm db:migrate"]);
    expect(screen.getByText("Boot the stack.")).toBeInTheDocument();
  });

  it("treats an empty `commands` array as no signal (legacy parse still applies)", () => {
    renderSection(
      makeSection({ body: "Run it.\n\n```sh\npnpm dev\n```", commands: [] }),
    );

    expect(commandTexts()).toEqual(["pnpm dev"]);
  });

  it("degrades to plain Markdown when there is neither a `commands` array nor a code block", () => {
    renderSection(makeSection({ body: "# Getting started\n\nAsk a teammate.", commands: null }));

    expect(screen.queryAllByRole("button", { name: /copy command/i })).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByText("Ask a teammate.")).toBeInTheDocument();
  });

  it("ignores `commands` on every other section kind", () => {
    renderSection(
      makeSection({
        kind: "first-tasks",
        title: "First tasks",
        body: "Pick a good first issue.",
        commands: ["rm -rf /"],
      }),
    );

    expect(screen.queryAllByRole("button", { name: /copy command/i })).toHaveLength(0);
    expect(screen.queryByText("rm -rf /")).not.toBeInTheDocument();
    expect(screen.getByText("Pick a good first issue.")).toBeInTheDocument();
  });
});
