/* One inventory row: file name, folder path, root badge, token estimate.
   A plain button so selection stays keyboard-operable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { DocumentInventoryItem } from "@devdigest/shared";
import { fileName, folderPath, rootBadge } from "./helpers";
import { s } from "./styles";

export function DocumentRow({
  item,
  selected,
  onSelect,
}: {
  item: DocumentInventoryItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("context");
  const dir = folderPath(item.path);
  // The root badge already says e.g. "specs" — only show the dir text when it
  // carries MORE information than that (a nested path), never a bare repeat.
  const dirLabel = dir !== item.root ? dir : "";
  const badge = rootBadge(item.root);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ ...s.row, ...(selected ? s.rowSelected : {}) }}
    >
      <span style={s.rowText}>
        <span style={s.rowName}>{fileName(item.path)}</span>
        {dirLabel && <span style={s.rowDir}>{dirLabel}</span>}
      </span>
      <span style={s.rowMeta}>
        <Badge color={badge.color} bg={badge.bg} mono>
          {item.root}
        </Badge>
        <span className="tnum" style={s.tokens}>
          {t("tokens", { count: item.token_estimate })}
        </span>
      </span>
    </button>
  );
}
