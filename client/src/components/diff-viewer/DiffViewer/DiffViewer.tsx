/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  targetPath,
  targetLine,
  targetNonce,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** External "jump to this file:line" instruction (e.g. a Blast Radius
     caller click). Only the FileCard whose path matches gets targetLine. */
  targetPath?: string | null;
  targetLine?: number | null;
  targetNonce?: number;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          targetLine={f.path === targetPath ? (targetLine ?? null) : null}
          targetNonce={f.path === targetPath ? (targetNonce ?? 0) : 0}
        />
      ))}
    </div>
  );
}
