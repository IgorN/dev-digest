/* Read-only preview of the selected document. Untrusted repo markdown is
   rendered through the sanitizing @devdigest/ui Markdown primitive
   (react-markdown v9 strips dangerous URL schemes by default). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDocumentPreview } from "../../../../lib/hooks/context";
import { useAgents } from "../../../../lib/hooks/agents";
import { useSkills } from "../../../../lib/hooks/skills";
import { rootBadge } from "./helpers";
import { s } from "./styles";

export function PreviewPane({ repoId, path }: { repoId: string; path: string | null }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextDocumentPreview(repoId, path);
  // "Used by" count is direct attachments only — an agent inheriting the doc
  // via a linked skill is already counted once under "N skills", never
  // double-counted as an agent it wasn't explicitly attached to.
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const agentCount = path
    ? (agents?.filter((a) => a.context_documents?.includes(path)).length ?? 0)
    : 0;
  const skillCount = path
    ? (skills?.filter((sk) => sk.context_documents?.includes(path)).length ?? 0)
    : 0;

  return (
    <div style={s.pane}>
      {!path && (
        <EmptyState
          icon="FileText"
          title={t("preview.placeholderTitle")}
          body={t("preview.placeholderBody")}
        />
      )}

      {path && isLoading && (
        <div style={s.paneLoading}>
          <Skeleton height={16} width={280} />
          <Skeleton height={16} width="70%" />
          <Skeleton height={200} />
        </div>
      )}

      {path && isError && <ErrorState body={t("preview.loadError")} onRetry={() => refetch()} />}

      {path && data && (
        <>
          <div style={s.paneHeader}>
            <span className="mono" style={s.panePath}>
              {data.path}
            </span>
            <span style={s.paneMeta}>
              <span style={s.usedBy}>
                {t("preview.usedBy", { agents: agentCount })}
                {skillCount > 0 && ` · ${t("preview.usedBySkills", { count: skillCount })}`}
              </span>
              <Badge color={rootBadge(data.root).color} bg={rootBadge(data.root).bg} mono>
                {data.root}
              </Badge>
              {data.truncated && (
                <Badge color="var(--warn)" bg="var(--warn-bg)">
                  {t("preview.truncated")}
                </Badge>
              )}
              <span className="tnum" style={s.tokens}>
                {t("tokens", { count: data.token_estimate })}
              </span>
            </span>
          </div>
          <div style={s.paneBody}>
            <Markdown>{data.content}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}
