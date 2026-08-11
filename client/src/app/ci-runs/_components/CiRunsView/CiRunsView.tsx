/* CiRunsView — the /ci-runs leaf (screen_cizruns.jsx, ScreenCIRuns :18-52).

   Two refresh concepts live here and are deliberately NOT the same thing:

   - the "auto-refresh on" indicator describes `useCiRuns`'s 30 s re-read of the
     LOCAL ci_runs table while this page is mounted and visible. Nothing is
     pushed to the studio and GitHub is not polled in the background;
   - the Refresh BUTTON is the only GitHub pull: it runs the server-side ingest
     (list workflow runs → download `devdigest-result.json` → persist). Its
     result is reported honestly — a batch where some runs failed to ingest is
     partial success, not "done" and not a total failure. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useCiRuns, useRefreshCiRuns, type CiRunsFilters as Filters } from "@/lib/hooks/ci-runs";
import { EMPTY_CTA_HREF } from "./constants";
import { hasActiveFilters, sourceOptions } from "./helpers";
import { s } from "./styles";
import { CiRunsFilters } from "./_components/CiRunsFilters";
import { CiRunsTable } from "./_components/CiRunsTable";

export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const [filters, setFilters] = React.useState<Filters>({});
  const { data, isLoading, isError, refetch } = useCiRuns(filters);
  const refresh = useRefreshCiRuns();

  const runs = data?.runs ?? [];
  const filtered = hasActiveFilters(filters);
  const noRows = !isLoading && !isError && runs.length === 0;
  // Two DISTINCT zero-row states, told apart by whether any chip is non-default
  // — never by the row array alone:
  //   - no filters  → "No CI runs yet" + the set-up CTA (AC-53), replacing the
  //     whole page per the design's empty screen;
  //   - filters on  → "No runs match these filters" + Clear filters, keeping the
  //     header and the chip row so the user can actually widen the query.
  // Collapsing them would tell a workspace that HAS runs it has none.
  const showEmptyState = noRows && !filtered;
  const showFilteredEmpty = noRows && filtered;

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      {/* The header renders in EVERY state, empty included. Refresh is the only
          way to pull the first run from GitHub, so hiding it behind "there is at
          least one run" is a deadlock: no rows ⇒ no button ⇒ no rows. The design's
          empty screen replaced the whole page, but the design had no
          Refresh-driven ingest to strand. */}
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{t("runs.title")}</h1>
          <p style={s.subtitle}>{t("runs.subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <span style={s.autoRefresh}>
            <span style={s.autoRefreshDot} />
            {t("runs.autoRefresh")}
          </span>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>
      </div>

      <RefreshOutcome refresh={refresh} />

      {showEmptyState ? (
        <EmptyState
          icon="Workflow"
          title={t("runs.emptyTitle")}
          body={t("runs.emptyBody")}
          cta={t("runs.emptyCta")}
          onCta={() => router.push(EMPTY_CTA_HREF)}
        />
      ) : (
        <>
          <CiRunsFilters
            filters={filters}
            onChange={setFilters}
            agents={data?.agents ?? []}
            repos={data?.repos ?? []}
            sources={sourceOptions(runs, filters.source)}
          />

          {isLoading && (
            <div style={s.loading}>
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          )}
          {isError && <ErrorState body={t("runs.subtitle")} onRetry={() => refetch()} />}
          {showFilteredEmpty && (
            <EmptyState
              icon="Filter"
              title={t("runs.emptyFilteredTitle")}
              body={t("runs.emptyFilteredBody")}
              cta={t("runs.clearFilters")}
              onCta={() => setFilters({})}
            />
          )}
          {!isLoading && !isError && !showFilteredEmpty && <CiRunsTable runs={runs} />}
        </>
      )}
    </AppShell>
  );
}

/** The Refresh result, reported for what it is. `CiIngestResult.failures[]`
   carries a reason per workflow run, so a batch that ingested some runs and
   failed others reads as partial success rather than as a flat "done". */
function RefreshOutcome({ refresh }: { refresh: ReturnType<typeof useRefreshCiRuns> }) {
  const t = useTranslations("ci");

  if (refresh.isError) {
    return (
      <div style={s.refreshError} role="status" aria-live="polite">
        {refresh.error instanceof Error ? refresh.error.message : String(refresh.error)}
      </div>
    );
  }
  if (!refresh.data) return null;

  const { examined, ingested, failures } = refresh.data;
  return (
    <div style={s.refreshOutcome} role="status" aria-live="polite">
      {failures.length > 0
        ? t("runs.refreshPartial", { ingested, examined, failed: failures.length })
        : t("runs.refreshDone", { ingested, examined })}
    </div>
  );
}
