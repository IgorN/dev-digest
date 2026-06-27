/* SkillPreviewDrawer — side preview opened by clicking a skill card. Shows the
   skill's metadata and its rendered markdown body (the block injected into an
   agent's prompt), with an Edit action into the full editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Drawer, Badge, Button, Markdown, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../lib/hooks/skills";
import { skillTypeColor, SKILL_SOURCE_LABEL } from "../../../../lib/skill-type";
import { s } from "./styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const update = useUpdateSkill();

  return (
    <Drawer
      width={560}
      title={<span className="mono">{skill.name}</span>}
      subtitle={skill.description || t("card.noDescription")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.enabledLabel}>
            {t("preview.enabled")}
            <Toggle
              on={skill.enabled}
              onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
              size={16}
            />
          </label>
          <Button kind="primary" icon="Edit" onClick={() => router.push(`/skills/${skill.id}`)}>
            {t("preview.edit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.metaRow}>
          <Badge color={skillTypeColor(skill.type)}>{skill.type}</Badge>
          <Badge color="var(--text-muted)">{SKILL_SOURCE_LABEL[skill.source]}</Badge>
          <Badge color="var(--text-muted)">v{skill.version}</Badge>
        </div>
        <div style={s.sectionLabel}>{t("preview.bodyLabel")}</div>
        <div style={s.markdown}>
          <Markdown>{skill.body}</Markdown>
        </div>
      </div>
    </Drawer>
  );
}
