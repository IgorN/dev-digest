/* /context — Project Context. Lists every markdown document under the active
   repo clone's configured context roots (specs/docs/insights) with a read-only
   preview pane. Agents/skills attach these documents by PATH — content is read
   fresh from the clone at review time, never persisted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useContextInventory } from "../../../../lib/hooks/context";
import { DocumentRow } from "./DocumentRow";
import { PreviewPane } from "./PreviewPane";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const { repoId, activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name?.split("/").pop() ?? activeRepo?.full_name ?? "repo";

  const { data, isLoading, isError, refetch } = useContextInventory(repoId);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const crumb = [{ label: t("breadcrumbLab") }, { label: t("breadcrumb") }];

  if (!repoId) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="Folder" title={t("noRepoTitle")} body={t("noRepoBody")} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>
              {t("title")} <span style={s.repoName}>{repoName}</span>
            </h1>
            {data?.has_clone && <p style={s.subtitle}>{t("subtitle", { count: data.count })}</p>}
          </div>
        </div>

        {isLoading && (
          <div style={s.loading}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {/* AC-4: a repo without a local clone is an expected state, not an error. */}
        {!isLoading && !isError && data && !data.has_clone && (
          <EmptyState icon="GitBranch" title={t("noClone.title")} body={t("noClone.body")} />
        )}

        {!isLoading && !isError && data?.has_clone && data.items.length === 0 && (
          <EmptyState icon="FileText" title={t("noDocs.title")} body={t("noDocs.body")} />
        )}

        {!isLoading && !isError && data?.has_clone && data.items.length > 0 && (
          <div style={s.split}>
            <div style={s.list}>
              {data.items.map((item) => (
                <DocumentRow
                  key={item.path}
                  item={item}
                  selected={item.path === selectedPath}
                  onSelect={() => setSelectedPath(item.path)}
                />
              ))}
            </div>
            <PreviewPane repoId={repoId} path={selectedPath} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
