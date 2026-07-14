/* SplitSuggestionBanner — shown only when split_suggestion.too_big; lists the
   server's proposed_splits (name + file count). Omitted entirely otherwise
   (SmartDiffViewer only renders this when too_big is true). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon } from "@devdigest/ui";
import type { SmartDiff } from "@/lib/types";
import { s } from "./styles";

export function SplitSuggestionBanner({
  splitSuggestion,
}: {
  splitSuggestion: SmartDiff["split_suggestion"];
}) {
  const t = useTranslations("prReview");
  return (
    <Card style={{ borderColor: "var(--warn)" }}>
      <div style={s.bannerHeader}>
        <Icon.AlertTriangle size={16} style={s.bannerIcon} />
        <span style={s.bannerTitle}>
          {t("smartDiff.largeTitle", { lines: splitSuggestion.total_lines })}
        </span>
      </div>
      <p style={s.bannerBody}>{t("smartDiff.largeBody")}</p>
      {splitSuggestion.proposed_splits.length > 0 && (
        <ul style={s.splitList}>
          {splitSuggestion.proposed_splits.map((split) => (
            <li key={split.name} style={s.splitItem}>
              <span style={s.splitName}>{split.name}</span>
              <span style={s.splitCount}>
                {t("smartDiff.filesCount", { count: split.files.length })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
