/* ImportSkillDrawer — upload a markdown file or a zip archive, see the parsed
   "core" as a PREVIEW, and only save on explicit confirm. Executable parts of an
   archive are never processed (the server lists them as ignored). A foreign skill
   is foreign instructions in an agent's prompt — hence the trust note + confirm. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Drawer, Button, Badge, Markdown, Icon } from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import { useImportSkill, useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { skillTypeColor } from "../../../../../../lib/skill-type";
import { fileToBase64 } from "./helpers";
import { s } from "./styles";

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const importer = useImportSkill();
  const create = useCreateSkill();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [filename, setFilename] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  const onPick = async (file: File) => {
    setError(null);
    setPreview(null);
    setFilename(file.name);
    try {
      const content_base64 = await fileToBase64(file);
      const result = await importer.mutateAsync({ filename: file.name, content_base64 });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.parseError"));
    }
  };

  const confirmSave = async () => {
    if (!preview) return;
    const skill = await create.mutateAsync({
      name: preview.name,
      description: preview.description,
      type: preview.type,
      source: preview.source,
      body: preview.body,
      // Foreign instructions: import DISABLED until the user vets and enables it.
      enabled: false,
    });
    toast.success(t("import.saved", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Drawer
      width={560}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            onClick={confirmSave}
            disabled={!preview || create.isPending}
          >
            {create.isPending ? t("import.saving") : t("import.confirmSave")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {/* trust note — a foreign skill is foreign instructions in the prompt */}
        <div style={s.trust}>
          <Icon.Sparkles size={14} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
          <span>{t("import.trustNote")}</span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.mdx,.txt,.zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset so re-picking the SAME file (e.g. to retry after an error)
            // fires onChange again — the browser suppresses it otherwise.
            e.target.value = "";
            if (f) void onPick(f);
          }}
        />
        <Button
          kind="secondary"
          icon="Upload"
          full
          onClick={() => fileRef.current?.click()}
          loading={importer.isPending}
        >
          {filename ? t("import.replaceFile", { name: filename }) : t("import.pickFile")}
        </Button>

        {error && <div style={s.error}>{error}</div>}

        {preview && (
          <div style={s.preview}>
            <div style={s.previewHead}>
              <span className="mono" style={s.previewName}>
                {preview.name}
              </span>
              <Badge color={skillTypeColor(preview.type)}>{preview.type}</Badge>
            </div>
            {preview.description && <div style={s.previewDesc}>{preview.description}</div>}
            {preview.notes && <div style={s.notes}>{preview.notes}</div>}

            {preview.ignored_files.length > 0 && (
              <div style={s.ignored}>
                <div style={s.ignoredHead}>
                  <Icon.X size={12} style={{ color: "var(--text-muted)" }} />
                  {t("import.ignoredTitle", { count: preview.ignored_files.length })}
                </div>
                <ul style={s.ignoredList}>
                  {preview.ignored_files.map((f) => (
                    <li key={f} className="mono">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={s.bodyLabel}>{t("import.bodyLabel")}</div>
            <div style={s.markdown}>
              <Markdown>{preview.body}</Markdown>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
