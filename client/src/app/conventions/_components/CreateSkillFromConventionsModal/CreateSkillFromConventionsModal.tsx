/* CreateSkillFromConventionsModal — merge the accepted convention candidates into
   a `repo-conventions` skill. The body is server-merged but fully editable here;
   saving goes through the normal create-skill flow (source = extracted). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, SelectInput, Textarea, Toggle, Button, Skeleton, Icon } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { useConventionSkillDraft } from "../../../../lib/hooks/conventions";
import { useToast } from "../../../../lib/toast";
import { SKILL_TYPE_OPTIONS } from "../../../../lib/skill-type";
import { s } from "./styles";

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  onClose,
}: {
  repoId: string;
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const { data: draft, isLoading } = useConventionSkillDraft(repoId, true);
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [seeded, setSeeded] = React.useState(false);

  // Seed the form once the draft arrives.
  React.useEffect(() => {
    if (draft && !seeded) {
      setName(draft.name);
      setDescription(draft.description);
      setType(draft.type);
      setBody(draft.body);
      setSeeded(true);
    }
  }, [draft, seeded]);

  const tokenEstimate = Math.ceil(body.length / 4);

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || `${repoName}-conventions`,
      description,
      type,
      source: "extracted",
      body,
      enabled,
    });
    toast.success(t("modal.saved", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Modal
      width={760}
      title={t("modal.title")}
      subtitle={draft?.name ?? `${repoName}-conventions`}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>{t("modal.footerNote")}</span>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={submit}
            disabled={create.isPending || isLoading || (draft?.count ?? 0) === 0}
          >
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {isLoading ? (
          <>
            <Skeleton height={40} />
            <Skeleton height={120} />
          </>
        ) : (
          <>
            <div style={s.banner}>
              <Icon.Sparkles size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <span>{t("modal.mergedFrom", { count: draft?.count ?? 0, repo: repoName })}</span>
            </div>

            <FormField label={t("modal.name")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("modal.description")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <div style={s.row}>
              <div style={{ flex: 1 }}>
                <FormField label={t("modal.type")}>
                  <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...SKILL_TYPE_OPTIONS]} />
                </FormField>
              </div>
              <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
                <Toggle on={enabled} onChange={setEnabled} size={16} />
              </FormField>
            </div>
            <FormField
              label={t("modal.body")}
              right={<span style={s.tokens}>{t("modal.tokens", { count: tokenEstimate })}</span>}
            >
              <Textarea value={body} onChange={setBody} rows={12} mono />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
