"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { DEFAULT_SKILL_TYPE, SKILL_TYPE_OPTIONS } from "../../../../../../lib/skill-type";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

/** Create-skill modal — name/description/type/body. A skill is text + config
    only; the body is the markdown injected into an agent's prompt. */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_SKILL_TYPE);
  const [body, setBody] = React.useState(t("create.defaultBody"));

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      type,
      body,
    });
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("fields.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("fields.description")} hint={t("fields.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("fields.type")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={[...SKILL_TYPE_OPTIONS]}
          />
        </FormField>
        <FormField label={t("fields.body")} hint={t("fields.bodyHint")}>
          <Textarea value={body} onChange={setBody} rows={8} mono />
        </FormField>
      </div>
    </Modal>
  );
}
