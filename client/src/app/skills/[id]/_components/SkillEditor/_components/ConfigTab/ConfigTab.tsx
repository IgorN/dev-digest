/* Config tab — the skill's edit form: name, description (its directive
   interface), type, and the markdown body injected into an agent's prompt. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { SKILL_TYPE_OPTIONS } from "../../../../../../../lib/skill-type";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [versionMessage, setVersionMessage] = React.useState("");

  // Reset local form when switching skills.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setVersionMessage("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A body edit cuts a new immutable version — surface "unsaved" + a rough token
  // estimate (≈ chars/4) so the author sees the cost before saving.
  const bodyChanged = body !== skill.body;
  const tokenEstimate = Math.ceil(body.length / 4);

  const save = () =>
    update.mutate(
      // version_message only matters when the body changes (a new version is cut).
      { id: skill.id, patch: { name, description, type, body, enabled }, versionMessage: bodyChanged ? versionMessage : undefined },
      {
        onSuccess: (data) => {
          toast.success(t("editor.savedToast", { version: data.version }));
          setVersionMessage("");
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.configTitle")}</h2>
        <label style={s.enabledLabel}>
          {t("editor.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("fields.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label={t("fields.description")} hint={t("fields.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("fields.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...SKILL_TYPE_OPTIONS]} />
      </FormField>
      <FormField
        label={t("fields.body")}
        hint={t("editor.bodyVersionHint")}
        right={
          <span style={s.bodyMeta}>
            {bodyChanged && <span style={s.unsaved}>{t("editor.unsaved")}</span>}
            <span>{t("editor.tokenEstimate", { count: tokenEstimate })}</span>
          </span>
        }
      >
        <Textarea value={body} onChange={setBody} rows={16} mono />
      </FormField>

      {bodyChanged && (
        <FormField label={t("editor.versionMessage")} hint={t("editor.versionMessageHint")}>
          <TextInput
            value={versionMessage}
            onChange={setVersionMessage}
            placeholder={t("editor.versionMessagePlaceholder")}
          />
        </FormField>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
        {update.isSuccess && <span style={s.savedNote}>{t("editor.saved", { version: update.data?.version })}</span>}
      </div>
    </div>
  );
}
