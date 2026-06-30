/* SkillCard — name, type badge, description, enabled toggle. Clicking the card
   opens the side preview; the toggle and delete stop propagation. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../lib/hooks/skills";
import { skillTypeColor } from "../../../../lib/skill-type";
import { s } from "./styles";

export function SkillCard({
  sk,
  active,
  onClick,
  onToggle,
}: {
  sk: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  return (
    <div onClick={onClick} style={s.card(!!active, sk.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span className="mono" style={s.name}>
          {sk.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={sk.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.deleteConfirm", { name: sk.name }))) del.mutate(sk.id);
          }}
          disabled={del.isPending}
          title={t("card.delete")}
          aria-label={t("card.delete")}
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{sk.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={skillTypeColor(sk.type)}>{sk.type}</Badge>
        <Badge color="var(--text-muted)">v{sk.version}</Badge>
      </div>
    </div>
  );
}
