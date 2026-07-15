/* BlastCard — "what could these changes break?": changed symbols -> callers
   -> affected endpoints/crons, read from the repo-intel index (no analysis
   during review). Same three states as IntentCard: loading, not-yet-computed
   (EmptyState + recompute CTA), and populated. A `degraded` map (partial/
   ripgrep-fallback index) still renders — with an explanatory badge, never a
   blank screen — instead of hiding behind an error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, EmptyState, Button, Skeleton, Badge, Icon } from "@devdigest/ui";
import { useBlast, useRecomputeBlast } from "@/lib/hooks/blast";
import { SymbolRow } from "./SymbolRow";
import { s } from "./styles";

export function BlastCard({
  prId,
  diffPaths,
  onJumpToCode,
}: {
  prId: string | null;
  /** Paths this PR's diff actually contains — forwarded to each SymbolRow so
     it can tell an in-diff jump from an external GitHub link. */
  diffPaths: ReadonlySet<string>;
  /** Fired with a caller's file + line — the page switches to Files changed
     and scrolls/highlights that exact line (same mechanism as finding jumps),
     or opens the file on GitHub when it isn't part of this PR's diff. */
  onJumpToCode: (path: string, line: number) => void;
}) {
  const tBrief = useTranslations("brief");
  const t = useTranslations("blast");
  const { data: blast, isLoading } = useBlast(prId);
  const recompute = useRecomputeBlast(prId);

  const totalCallers = blast?.downstream.reduce((n, d) => n + d.callers.length, 0) ?? 0;
  const endpointCount = blast
    ? new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size
    : 0;
  const cronCount = blast ? new Set(blast.downstream.flatMap((d) => d.crons_affected)).size : 0;

  return (
    <section>
      <SectionLabel icon="Zap">{tBrief("block.blast")}</SectionLabel>
      <Card>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={16} width={280} />
            <Skeleton height={80} />
          </div>
        ) : !blast ? (
          <EmptyState
            icon="Zap"
            title={tBrief("unavailable")}
            body={tBrief("unavailableHint")}
            cta={recompute.isPending ? tBrief("card.recomputing") : tBrief("card.recompute")}
            onCta={() => recompute.mutate()}
            ctaLoading={recompute.isPending}
          />
        ) : (
          <>
            <div style={s.headerRow}>
              <div style={s.stats}>
                <Stat icon="Code" count={blast.changed_symbols.length} label={t("stat.symbols")} />
                <Stat icon="CornerDownRight" count={totalCallers} label={t("stat.callers")} />
                <Stat icon="Globe" count={endpointCount} label={t("stat.endpoints")} />
                {cronCount > 0 && <Stat icon="Clock" count={cronCount} label={t("stat.crons")} />}
                {blast.degraded && (
                  <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                    {t("degraded.badge")}
                  </Badge>
                )}
              </div>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                onClick={() => recompute.mutate()}
                loading={recompute.isPending}
              >
                {recompute.isPending ? tBrief("card.recomputing") : tBrief("card.recompute")}
              </Button>
            </div>

            {blast.degraded && (
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 12px" }}>
                {t(`degraded.${blast.degraded_reason ?? "no_data"}`)}
              </p>
            )}

            <p style={s.summary}>{blast.summary}</p>

            {blast.changed_symbols.length === 0 || totalCallers === 0 ? (
              <div style={s.noDownstream}>
                {t("noDownstream", { count: blast.changed_symbols.length })}
              </div>
            ) : (
              <div style={s.tree}>
                {blast.downstream.map((d, i) => (
                  <SymbolRow
                    key={d.symbol}
                    impact={d}
                    defaultOpen={i === 0}
                    diffPaths={diffPaths}
                    onJumpToCode={onJumpToCode}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

function Stat({ icon, count, label }: { icon: keyof typeof Icon; count: number; label: string }) {
  const I = Icon[icon];
  return (
    <span style={s.stat}>
      <I size={13} style={{ color: "var(--text-muted)" }} />
      <span style={s.statCount}>{count}</span>
      {label}
    </span>
  );
}
