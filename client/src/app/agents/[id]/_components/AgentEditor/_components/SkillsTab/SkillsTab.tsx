/* SkillsTab — attach/detach skills to an agent, toggle them, and drag to
   reorder. Order is the order the skill blocks appear in the assembled prompt.
   Attached skills sort to the top (draggable); the rest follow (attach via the
   checkbox). Every change persists the full ordered id set. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Checkbox, Badge, Icon, Skeleton, Button } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/skills";
import { skillTypeColor } from "../../../../../../../lib/skill-type";
import { reorder } from "./helpers";
import { s } from "./styles";

/** One attachable skill row. A real component (not a render fn) so React can
    reconcile it across drag-state / filter changes without remounting. */
function SkillRow({
  sk,
  attached,
  dragging,
  onToggle,
  onDragStart,
  onDrop,
  onDragEnd,
  dragHint,
  disabledLabel,
}: {
  sk: Skill;
  attached: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  dragHint: string;
  disabledLabel: string;
}) {
  return (
    <div
      style={s.row(attached, dragging)}
      draggable={attached}
      onDragStart={() => attached && onDragStart()}
      onDragOver={(e) => attached && e.preventDefault()}
      onDrop={() => attached && onDrop()}
      onDragEnd={onDragEnd}
    >
      <span style={s.grip(attached)} title={attached ? dragHint : undefined}>
        <Icon.Menu size={15} />
      </span>
      <Checkbox checked={attached} onChange={onToggle} />
      <span className="mono" style={s.name}>
        {sk.name}
      </span>
      {!sk.enabled && <span style={s.disabledTag}>{disabledLabel}</span>}
      <Badge color={skillTypeColor(sk.type)}>{sk.type}</Badge>
    </div>
  );
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: allSkills, isLoading } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);

  // Local ordered list of ATTACHED skill ids, seeded from the server links.
  const [attached, setAttached] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (links) setAttached(links.map((l) => l.skill_id));
  }, [links]);

  const persist = (next: string[]) => {
    setAttached(next);
    setSkills.mutate(next);
  };

  const skillsById = React.useMemo(() => {
    const m = new Map<string, Skill>();
    for (const sk of allSkills ?? []) m.set(sk.id, sk);
    return m;
  }, [allSkills]);

  // Ordered render list: attached (in order) first, then the rest. `persist`
  // always operates on the `attached` id array (not this filtered view), so an
  // id missing from `skillsById` while the catalog loads is never dropped.
  const attachedSkills = attached.map((id) => skillsById.get(id)).filter((x): x is Skill => !!x);
  const restSkills = (allSkills ?? []).filter((sk) => !attached.includes(sk.id));
  const q = filter.trim().toLowerCase();
  const match = (sk: Skill) => !q || `${sk.name} ${sk.description} ${sk.type}`.toLowerCase().includes(q);

  const toggle = (id: string) =>
    persist(attached.includes(id) ? attached.filter((x) => x !== id) : [...attached, id]);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    persist(reorder(attached, attached.indexOf(dragId), attached.indexOf(targetId)));
    setDragId(null);
  };

  const total = allSkills?.length ?? 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: attached.length, total })}</span>
        <div style={s.filter}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {isLoading ? (
        <div style={s.list}>
          <Skeleton height={42} />
          <Skeleton height={42} />
          <Skeleton height={42} />
        </div>
      ) : total === 0 ? (
        <div style={s.empty}>
          {t("skills.emptyBody")}
          <div style={{ marginTop: 12 }}>
            <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => router.push("/skills")}>
              {t("skills.emptyCta")}
            </Button>
          </div>
        </div>
      ) : (
        <div style={s.list}>
          {attachedSkills.filter(match).map((sk) => (
            <SkillRow
              key={sk.id}
              sk={sk}
              attached
              dragging={dragId === sk.id}
              onToggle={() => toggle(sk.id)}
              onDragStart={() => setDragId(sk.id)}
              onDrop={() => onDrop(sk.id)}
              onDragEnd={() => setDragId(null)}
              dragHint={t("skills.dragHint")}
              disabledLabel={t("skills.skillDisabled")}
            />
          ))}
          {restSkills.filter(match).map((sk) => (
            <SkillRow
              key={sk.id}
              sk={sk}
              attached={false}
              dragging={false}
              onToggle={() => toggle(sk.id)}
              onDragStart={() => {}}
              onDrop={() => {}}
              onDragEnd={() => setDragId(null)}
              dragHint={t("skills.dragHint")}
              disabledLabel={t("skills.skillDisabled")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
