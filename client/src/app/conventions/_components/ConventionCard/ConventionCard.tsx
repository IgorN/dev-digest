/* ConventionCard — one evidence-backed convention candidate with accept / reject
   / inline-edit. The evidence header links to the real code on GitHub. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { skillTypeColor } from "../../../../lib/skill-type";
import { confidenceColor, evidenceLabel } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate: c,
  onUpdate,
  pending,
}: {
  candidate: ConventionCandidate;
  onUpdate: (patch: { accepted?: boolean | null; rule?: string }) => void;
  pending?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(c.rule);

  // Re-sync the edit draft if the candidate identity changes (e.g. a re-scan
  // replaces the list) so we never save a stale rule from a previous card.
  React.useEffect(() => {
    setRule(c.rule);
    setEditing(false);
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.round(c.confidence * 100);
  const label = evidenceLabel(c.evidence_path, c.evidence_start_line, c.evidence_end_line);
  const accepted = c.accepted === true;
  const rejected = c.accepted === false;

  const saveEdit = () => {
    onUpdate({ rule: rule.trim() || c.rule });
    setEditing(false);
  };

  return (
    <div style={s.card(accepted, rejected)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.ruleEdit}>
            <TextInput value={rule} onChange={setRule} />
            <Button kind="primary" size="sm" icon="Check" onClick={saveEdit}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => { setRule(c.rule); setEditing(false); }}>
              {t("card.cancel")}
            </Button>
          </div>
        ) : (
          <div style={s.rule}>
            {c.category && (
              <Badge color={skillTypeColor("convention")} style={{ marginRight: 8, fontStyle: "normal" }}>
                {c.category}
              </Badge>
            )}
            {c.rule}
          </div>
        )}

        <div style={s.evidence}>
          <div style={s.evidenceHead}>
            {c.evidence_url ? (
              <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" style={s.evidenceLink}>
                {label}
              </a>
            ) : (
              <span>{label}</span>
            )}
            <button
              style={s.copyBtn}
              title={t("card.copy")}
              aria-label={t("card.copy")}
              onClick={() => navigator.clipboard?.writeText(c.evidence_snippet)}
            >
              <Icon.Copy size={13} />
            </button>
          </div>
          <pre style={s.snippet}>{c.evidence_snippet}</pre>
        </div>

        <div style={s.confRow}>
          <span style={s.confLabel}>{t("card.confidence")}</span>
          <div style={s.confTrack}>
            <div style={s.confFill(pct, confidenceColor(c.confidence))} />
          </div>
          <span style={s.confPct}>{pct}%</span>
        </div>
      </div>

      <div style={s.actions}>
        {accepted ? (
          <span style={s.acceptedPill}>
            <Icon.Check size={13} /> {t("card.accepted")}
          </span>
        ) : (
          <Button
            kind="primary"
            icon="Sparkles"
            full
            onClick={() => onUpdate({ accepted: true })}
            disabled={pending}
          >
            {t("card.accept")}
          </Button>
        )}
        {!accepted && (
          <Button kind="secondary" size="sm" icon="Edit" full onClick={() => setEditing(true)} disabled={pending}>
            {t("card.edit")}
          </Button>
        )}
        <Button
          kind="secondary"
          size="sm"
          icon="X"
          full
          onClick={() => onUpdate({ accepted: rejected ? null : false })}
          disabled={pending}
        >
          {rejected ? t("card.undoReject") : t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
