/* CiRunsTable — the design's nine-column runs grid (screen_cizruns.jsx:35-52).

   Every string in a row is a SNAPSHOT captured inside someone else's CI (the
   agent name, the PR title, the source label). All of it is rendered as escaped
   React text — no dangerouslySetInnerHTML, and no value is ever interpolated
   into a URL. The one URL rendered is `github_url` exactly as the server
   persisted it at ingest, through MonoLink (which already sets target="_blank"
   + rel="noopener noreferrer"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink, SEV } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { COLUMN_KEYS } from "../../constants";
import { findingBreakdown, formatDuration, formatTimestamp, statusMeta } from "../../helpers";
import { s } from "../../styles";

export function CiRunsTable({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("ci");
  return (
    <div style={s.tableCard}>
      <div style={s.headRow} data-testid="ci-runs-header">
        {COLUMN_KEYS.map((key, i) => (
          <div key={key ?? `action-${i}`}>{key ? t(`runs.table.${key}`) : ""}</div>
        ))}
      </div>
      {runs.map((run, i) => (
        <RunRow key={run.id} run={run} last={i === runs.length - 1} />
      ))}
    </div>
  );
}

function RunRow({ run, last }: { run: CiRun; last: boolean }) {
  const t = useTranslations("ci");
  const status = statusMeta(run.status);

  return (
    <div style={s.row(last)} data-testid={`ci-run-row-${run.id}`}>
      <span className="mono" style={s.ts}>
        {formatTimestamp(run.ran_at)}
      </span>

      <PullRequestCell run={run} />

      <span style={s.agentCell}>
        <Icon.Cpu size={13} style={s.agentIcon} />
        <span style={s.agentName}>{run.agent ?? "—"}</span>
      </span>

      {run.source ? (
        <Badge color="var(--text-secondary)" icon="Workflow">
          {run.source}
        </Badge>
      ) : (
        <span style={s.dash}>—</span>
      )}

      <span className="tnum" style={s.duration}>
        {formatDuration(run.duration_s)}
      </span>

      <FindingsCell run={run} />

      <span className="mono tnum" style={s.cost}>
        {formatCost(run.cost_usd)}
      </span>

      {status ? (
        <Badge color={status.color} bg={status.bg} dot>
          {t(`runs.status.${status.messageKey}`)}
        </Badge>
      ) : (
        <span style={s.dash}>—</span>
      )}

      {run.github_url ? (
        <MonoLink href={run.github_url}>{t("runs.viewJob")}</MonoLink>
      ) : (
        <span style={s.dash}>—</span>
      )}
    </div>
  );
}

/** `#482 Add rate limiting…`. With no known title the number stands alone —
   never a fabricated placeholder (AC-47). */
function PullRequestCell({ run }: { run: CiRun }) {
  const t = useTranslations("ci");
  if (run.pr_number == null) return <span style={s.dash}>—</span>;
  return (
    <div
      style={s.prCell}
      aria-label={run.pr_title ? undefined : t("runs.noTitle", { number: run.pr_number })}
    >
      <span className="mono" style={s.prNumber}>
        #{run.pr_number}
      </span>
      {run.pr_title ? (
        <>
          {" "}
          <span style={s.prTitle} title={run.pr_title}>
            {run.pr_title}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** One icon+count pair per NON-ZERO severity; `—` when all three are zero or
   unknown — never `0` (AC-48). Ported from the design's CIFindingsCell. */
function FindingsCell({ run }: { run: CiRun }) {
  const items = findingBreakdown(run);
  if (items.length === 0) return <span style={s.dash}>—</span>;
  return (
    <div style={s.findingsCell}>
      {items.map(({ severity, count }) => {
        const sev = SEV[severity];
        const I = Icon[sev.icon];
        return (
          <span key={severity} style={s.findingPair(sev.c)} title={sev.label}>
            <I size={12} />
            <span className="tnum">{count}</span>
          </span>
        );
      })}
    </div>
  );
}
