/* /repos/:repoId/onboarding — the per-repo Onboarding Tour. Reads the persisted
   tour (never auto-generates) and lets the user Generate/Regenerate on demand.
   'use client' leaf: all data flows through the onboarding hooks, not JSX. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboarding, useRecomputeOnboarding } from "@/lib/hooks/onboarding";
import { SectionCard } from "./SectionCard";
import { TableOfContents } from "./TableOfContents";
import { isDegraded, timeAgo } from "./helpers";
import { s } from "./styles";

export function OnboardingView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: tour, isLoading, isError, refetch } = useOnboarding(repoId);
  const recompute = useRecomputeOnboarding(repoId);

  const repoName = activeRepo?.full_name?.split("/").pop() ?? activeRepo?.full_name ?? repoId;
  const crumb = [{ label: t("breadcrumbLab") }, { label: t("breadcrumb") }];

  // The highlighted ToC entry. Explicit-selection only (a ToC click or a section
  // header click) — see TableOfContents for why there is no scroll-spy. Defaults
  // to the first section until the reader picks one.
  const [selectedKind, setSelectedKind] = React.useState<string | null>(null);

  // Stable ToC item list (title per section) — derived from the tour when present.
  const tocItems = React.useMemo(
    () =>
      (tour?.sections ?? []).map((section) => {
        const key = `section.${section.kind}`;
        return { kind: section.kind, label: t.has(key) ? t(key) : section.title };
      }),
    [tour, t],
  );

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const degraded = tour ? isDegraded(tour) : false;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("titlePrefix")} <span style={s.repoName}>{repoName}</span>
            </h1>
            {tour && (
              <p style={s.subtitle}>
                {t("subtitle", {
                  count: tour.files_indexed ?? 0,
                  relative: timeAgo(tour.generated_at),
                })}
              </p>
            )}
          </div>
          {/* Regenerate is only offered once a tour exists; the no-tour state
             carries its own Generate CTA below. Disabled while pending (AC-4). */}
          {tour && (
            <div style={s.headerActions}>
              <Button
                icon="RefreshCw"
                onClick={() => recompute.mutate()}
                loading={recompute.isPending}
              >
                {recompute.isPending ? t("regenerating") : t("regenerate")}
              </Button>
            </div>
          )}
        </div>

        {isLoading && (
          <div style={s.loading}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}

        {isError && <ErrorState title={t("loadError.title")} onRetry={() => refetch()} />}

        {/* AC-17: no generated tour → empty state with a Generate CTA. The CTA is
           the only generation trigger (a GET never auto-generates); it disables
           while the recompute is pending (AC-4). */}
        {!isLoading && !isError && tour === null && (
          <EmptyState
            icon="Sparkles"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={recompute.isPending ? t("generate.generating") : t("generate.cta")}
            onCta={() => recompute.mutate()}
            ctaLoading={recompute.isPending}
          />
        )}

        {!isLoading && !isError && tour && (
          <>
            {/* AC-14: honest degraded badge + reason when the index isn't full. */}
            {degraded && (
              <div style={s.degraded}>
                <div style={s.degradedHead}>
                  <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                    {t("degraded.badge")}
                  </Badge>
                  <span style={s.degradedLabel}>{t("degraded.reasonLabel")}</span>
                </div>
                <p style={s.degradedReason}>
                  {tour.degraded_reason ?? t("degraded.unknownReason")}
                </p>
              </div>
            )}

            {/* Two columns: the "On this page" ToC (only when a tour exists) +
               the main sections column. Clicking either a ToC entry or a section
               header selects that section. */}
            <div style={s.layout}>
              <TableOfContents
                items={tocItems}
                label={t("onThisPage")}
                active={selectedKind ?? tocItems[0]?.kind ?? null}
                onSelect={setSelectedKind}
              />
              <div style={s.sections}>
                {tour.sections.map((section) => (
                  <SectionCard
                    key={section.kind}
                    section={section}
                    repo={activeRepo}
                    onActivate={() => setSelectedKind(section.kind)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
