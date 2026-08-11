/* EntryPointView — the conditional landing at `/multi-agent-review`
   (AC-22, AC-22a, AC-22b).

   One round trip decides the state: the latest multi-run for the ACTIVE
   repository. A resolved multi-run renders the result view inline; an explicit
   empty result renders the Configure-run form.

   Two rules this leaf exists to hold:

   1. It renders INLINE and never redirects to `/multi-agent-review/<id>`. A
      redirect would trap the Back button — from a result the user presses Back,
      lands here, and is immediately pushed forward again.
   2. "No multi-run" arrives as a SUCCESSFUL query with `multi_run: null`, never
      as an error, so the empty branch is chosen on `data.multi_run` and never
      on `isError` (AC-22b).

   The resolved multi-run may still be running, or may have failed outright —
   neither falls back to the form. It is still the most recent result, and
   `MultiRunView` opens it in its live state; the way out is `⚙ Configure run`.

   This is the ONLY place the resolver drives a branch; the explicit
   `/multi-agent-review/configure` address stays unconditional (AC-22c). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useLatestMultiRun } from "@/lib/hooks/multi-runs";
import { ConfigureRunView } from "../ConfigureRunView";
import { MultiRunView } from "../MultiRunView";

function LandingSkeleton() {
  const t = useTranslations("multiAgent");
  return (
    <AppShell crumb={[{ label: t("result.crumbRoot") }]}>
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={28} width={320} />
        <Skeleton height={200} />
      </div>
    </AppShell>
  );
}

export function EntryPointView() {
  const { repoId, reposLoaded } = useActiveRepo();
  const { data, isLoading } = useLatestMultiRun({ repoId });

  // No active repository — there is nothing to resolve against, so offer the
  // form (the query is disabled in this state and never resolves on its own).
  if (!repoId) return reposLoaded ? <ConfigureRunView /> : <LandingSkeleton />;

  if (isLoading || !data) return <LandingSkeleton />;

  return data.multi_run ? <MultiRunView multiRunId={data.multi_run.id} /> : <ConfigureRunView />;
}
