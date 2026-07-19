/* IntentCard — "why was this PR opened" summary + in-scope/out-of-scope lists.
   Three states: loading, not-yet-computed (EmptyState + recompute CTA), and
   populated (summary quote + two lists). Recompute is an explicit user action
   in BOTH states — never automatic. No "RISK AREAS" chips here: that's a
   separate, later feature, not part of the Intent contract. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, EmptyState, Button, Skeleton, Icon, type IconName } from "@devdigest/ui";
import { useIntent, useRecomputeIntent } from "@/lib/hooks/intent";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);

  return (
    <section>
      <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
      <Card>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={16} width={280} />
            <Skeleton height={80} />
          </div>
        ) : !intent ? (
          <EmptyState
            icon="Target"
            title={t("unavailable")}
            body={t("unavailableHint")}
            cta={recompute.isPending ? t("card.recomputing") : t("card.recompute")}
            onCta={() => recompute.mutate()}
            ctaLoading={recompute.isPending}
          />
        ) : (
          <>
            <div style={s.headerRow}>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                onClick={() => recompute.mutate()}
                loading={recompute.isPending}
              >
                {recompute.isPending ? t("card.recomputing") : t("card.recompute")}
              </Button>
            </div>
            <p style={s.summary}>{intent.intent}</p>
            <div style={s.lists}>
              <IntentList
                label={t("card.inScope")}
                icon="CheckCircle"
                iconColor="var(--ok)"
                items={intent.in_scope}
              />
              <IntentList
                label={t("card.outOfScope")}
                icon="XCircle"
                iconColor="var(--crit)"
                items={intent.out_of_scope}
              />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function IntentList({
  label,
  icon,
  iconColor,
  items,
}: {
  label: string;
  icon: IconName;
  iconColor: string;
  items: string[];
}) {
  const ListIcon = Icon[icon];
  return (
    <div style={s.listCol}>
      <div style={s.listHeader}>
        <ListIcon size={13} style={{ color: iconColor }} />
        <span style={s.listLabel}>{label}</span>
      </div>
      {items.length === 0 ? (
        <span style={s.emptyList}>—</span>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={i} style={s.listItemRow}>
              <span style={s.listItemDot}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
