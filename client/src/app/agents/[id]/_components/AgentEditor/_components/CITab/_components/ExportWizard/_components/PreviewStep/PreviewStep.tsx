/* PreviewStep — the wizard's two-pane file preview
   (design-src/screen_export.jsx:64-72).

   The tree renders WHATEVER THE SERVER GENERATED — never the design's
   hard-coded `EXPORT_TREE` (which omits the runner entirely) and never its
   `YAML_PREVIEW` (which is a fabricated workflow with no `permissions:` block,
   no fork guard and CLI flags the runner does not accept). Runner entries carry
   a placeholder marker and empty contents, so ~1.6 MB of bundle text never
   reaches the DOM (AC-69, AC-71). Only the workflow pane accepts input (AC-70). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { isPlaceholder } from "../../helpers";
import { s } from "../../styles";

export function PreviewStep({
  files,
  selectedPath,
  onSelect,
  workflowValue,
  onWorkflowChange,
  isGenerating,
}: {
  files: CiFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Current workflow contents (the user's edit when there is one). */
  workflowValue: string;
  onWorkflowChange: (next: string) => void;
  isGenerating: boolean;
}) {
  const t = useTranslations("ci");
  const selected = files.find((f) => f.path === selectedPath) ?? files[0];

  if (isGenerating && files.length === 0) {
    return <div style={s.previewWrap}>{t("exportWizard.generating")}</div>;
  }

  return (
    <div style={s.previewWrap}>
      <div style={s.tree}>
        <div style={s.treeLabel}>{t("exportWizard.filesToCreate")}</div>
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            style={s.treeRow(selected?.path === f.path)}
          >
            <Icon.FileText
              size={13}
              style={{
                color: selected?.path === f.path ? "var(--accent)" : "var(--text-muted)",
                flexShrink: 0,
              }}
            />
            <span className="mono">{f.path}</span>
          </button>
        ))}
      </div>

      <div style={s.pane}>
        <div style={s.paneHead}>
          <span className="mono" style={s.panePath}>
            {selected?.path ?? ""}
          </span>
          {selected?.editable && (
            <Badge color="var(--text-muted)" icon="Edit">
              {t("exportWizard.editable")}
            </Badge>
          )}
        </div>
        {!selected ? (
          <div style={s.placeholder} />
        ) : isPlaceholder(selected) ? (
          <div style={s.placeholder}>
            {t("exportWizard.runnerPlaceholder", { size: selected.placeholder ?? "" })}
          </div>
        ) : selected.editable ? (
          <textarea
            className="mono"
            aria-label={selected.path}
            value={workflowValue}
            onChange={(e) => onWorkflowChange(e.target.value)}
            spellCheck={false}
            style={s.paneEditor}
          />
        ) : (
          <pre className="mono" style={s.paneBody}>
            {selected.contents}
          </pre>
        )}
      </div>
    </div>
  );
}
