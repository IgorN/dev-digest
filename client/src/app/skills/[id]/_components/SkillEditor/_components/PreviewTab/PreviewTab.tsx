/* Preview tab — read-only render of the skill's markdown body, the way it lands
   in an agent's prompt under the "## Skills / rules" section. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <p style={s.note}>{t("previewTab.promptNote")}</p>
      <div style={s.block}>
        <div style={s.blockLabel}>## Skills / rules</div>
        <div style={s.markdown}>
          <Markdown>{skill.body}</Markdown>
        </div>
      </div>
    </div>
  );
}
