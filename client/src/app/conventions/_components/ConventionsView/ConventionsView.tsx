/* /conventions — Conventions Extractor. Scan the active repo for house-rules,
   accept/reject/edit each evidence-backed candidate, then merge the accepted
   ones into the `repo-conventions` skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
  useBulkConventions,
} from "../../../../lib/hooks/conventions";
import { useToast } from "../../../../lib/toast";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { acceptedCount, timeAgo } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { repoId, activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name?.split("/").pop() ?? activeRepo?.full_name ?? "repo";

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const bulk = useBulkConventions(repoId);
  const [creating, setCreating] = React.useState(false);

  const crumb = [{ label: t("breadcrumbLab") }, { label: t("breadcrumb") }];

  const runExtract = () =>
    extract.mutate(undefined, {
      onSuccess: (r) => toast.success(t("extractedToast", { verified: r.verified, proposed: r.proposed })),
    });

  if (!repoId) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="ListChecks" title={t("noRepoTitle")} body={t("noRepoBody")} />
        </div>
      </AppShell>
    );
  }

  const candidates = data?.candidates ?? [];
  const scanned = (data?.scanned_at ?? null) != null;
  const accepted = acceptedCount(candidates);

  return (
    <AppShell crumb={crumb}>
      {creating && repoId && (
        <CreateSkillFromConventionsModal repoId={repoId} repoName={repoName} onClose={() => setCreating(false)} />
      )}
      <div style={s.page}>
        {isLoading && (
          <div style={s.list}>
            <Skeleton height={28} width={320} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        )}

        {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && candidates.length === 0 && !scanned && (
          <div style={s.empty}>
            <EmptyState
              icon="ListChecks"
              title={t("emptyTitle")}
              body={t("emptyBody")}
              cta={extract.isPending ? t("extracting") : t("runExtraction")}
              onCta={runExtract}
              ctaLoading={extract.isPending}
            />
          </div>
        )}

        {!isLoading && !isError && (candidates.length > 0 || scanned) && (
          <>
            <div style={s.header}>
              <div style={s.headerText}>
                <h1 style={s.h1}>
                  {t("title")} <span style={s.repoName}>{repoName}</span>
                </h1>
                <p style={s.subtitle}>
                  {t("detectedFrom", { count: data?.sample_count ?? 0 })} · {t("lastScan", { ago: timeAgo(data?.scanned_at ?? null) })}
                </p>
              </div>
              <div style={s.headerActions}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  onClick={() => setCreating(true)}
                  disabled={accepted === 0}
                >
                  {t("createSkill")}
                </Button>
                <Button kind="secondary" size="sm" icon="RefreshCw" onClick={runExtract} loading={extract.isPending}>
                  {t("rescan")}
                </Button>
              </div>
            </div>

            {candidates.length > 0 ? (
              <>
                <div style={s.toolbar}>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="Check"
                    onClick={() => bulk.mutate(true)}
                    disabled={bulk.isPending}
                  >
                    {t("acceptAll", { count: candidates.length })}
                  </Button>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="X"
                    onClick={() => bulk.mutate(false)}
                    disabled={bulk.isPending}
                  >
                    {t("rejectAll")}
                  </Button>
                </div>
                <div style={s.list}>
                  {candidates.map((c) => (
                    <ConventionCard
                      key={c.id}
                      candidate={c}
                      pending={update.isPending && update.variables?.id === c.id}
                      onUpdate={(patch) => update.mutate({ id: c.id, patch })}
                    />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon="Search" title={t("noneFoundTitle")} body={t("noneFoundBody")} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
