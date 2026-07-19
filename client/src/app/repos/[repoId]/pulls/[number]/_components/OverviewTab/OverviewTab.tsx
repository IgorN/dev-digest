"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { PrBriefCard } from "./_components/PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** Paths this PR's diff actually contains — forwarded to BlastCard. */
  diffPaths: ReadonlySet<string>;
  /** Forwarded to BlastCard — see page.tsx's handleJumpToCode. */
  onJumpToCode: (path: string, line: number) => void;
}

export function OverviewTab({ prBody, prId, diffPaths, onJumpToCode }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}

      {/* PrBriefCard renders its own <section> (mirrors IntentCard/BlastCard's
         self-contained SectionLabel+Card shape) — no extra wrapper here,
         consistent with how the two cards below are consumed directly. */}
      <PrBriefCard prId={prId} diffPaths={diffPaths} onJumpToCode={onJumpToCode} />

      <div style={s.briefGrid}>
        <IntentCard prId={prId} />
        <BlastCard prId={prId} diffPaths={diffPaths} onJumpToCode={onJumpToCode} />
      </div>
    </>
  );
}
