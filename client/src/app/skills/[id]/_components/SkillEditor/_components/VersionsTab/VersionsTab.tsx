/* Versions tab — the skill's immutable body-snapshot history (newest first).
   Each save records a version; "Diff" shows what changed vs the previous one,
   "Restore" brings an old body back (as a new version). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton, EmptyState } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { diffLines } from "./helpers";
import { s } from "./styles";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }
  if (!versions || versions.length === 0) {
    return <EmptyState icon="GitBranch" title={t("versions.emptyTitle")} body={t("versions.emptyBody")} />;
  }

  const restore = (v: SkillVersion) => {
    if (!window.confirm(t("versions.restoreConfirm", { version: v.version }))) return;
    update.mutate(
      { id: skill.id, patch: { body: v.body }, versionMessage: t("versions.restoreMessage", { version: v.version }) },
      { onSuccess: (data) => toast.success(t("editor.savedToast", { version: data.version })) },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.title}>{t("versions.title")}</h2>
        <span style={s.count}>{t("versions.count", { count: versions.length })}</span>
      </div>
      <p style={s.hint}>{t("versions.reproHint")}</p>

      {versions.map((v, idx) => {
        const isCurrent = v.version === skill.version;
        const prev = versions[idx + 1]; // older neighbour (list is newest-first)
        const diffOpen = openDiff === v.version;
        return (
          <div key={v.version} style={s.row}>
            <div style={s.rowHead}>
              <Badge color={isCurrent ? "var(--accent)" : "var(--text-muted)"}>v{v.version}</Badge>
              <span style={v.message ? s.message : s.noMessage}>{v.message || "—"}</span>
              <span style={s.when}>{formatWhen(v.created_at)}</span>
              {isCurrent && <span style={s.currentTag}>{t("versions.current")}</span>}
              {prev && (
                <Button
                  kind="secondary"
                  size="sm"
                  onClick={() => setOpenDiff(diffOpen ? null : v.version)}
                >
                  {t("versions.diff")}
                </Button>
              )}
              {!isCurrent && (
                <Button kind="ghost" size="sm" onClick={() => restore(v)} disabled={update.isPending}>
                  {t("versions.restore")}
                </Button>
              )}
            </div>

            {diffOpen && prev && (
              <pre style={s.diff}>
                {diffLines(prev.body, v.body).map((line, i) => (
                  <span
                    key={`${v.version}-${i}`}
                    style={{
                      display: "block",
                      ...(line.type === "add" ? s.add : line.type === "del" ? s.del : s.eq),
                    }}
                  >
                    {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
                    {line.text}
                  </span>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
