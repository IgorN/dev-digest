"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
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
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}

      <div style={s.briefGrid}>
        <IntentCard prId={prId} />
        <BlastCard prId={prId} diffPaths={diffPaths} onJumpToCode={onJumpToCode} />
      </div>
    </>
  );
}
