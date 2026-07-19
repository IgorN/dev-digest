/* One onboarding section, rendered as a collapsible card: a colored icon badge +
   title header (click to toggle) over a per-kind body. Every kind falls back to
   the sanitized Markdown body when its structured data is absent, so the degraded
   no-clone skeleton still renders honestly. Untrusted model output only ever goes
   through the @devdigest/ui Markdown primitive and the strict MermaidDiagram —
   never dangerouslySetInnerHTML — and file links resolve through fileUrl →
   githubBlobUrl (safe host), never a raw model string in an href (AC-18). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, Markdown, MonoLink } from "@devdigest/ui";
import type { OnboardingLink, OnboardingSection } from "@devdigest/shared";
import type { Repo } from "@/lib/types";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import { fileUrl, resolveCommands, sectionAnchorId, sectionIcon } from "./helpers";
import { s } from "./styles";

export function SectionCard({
  section,
  repo,
  onActivate,
}: {
  section: OnboardingSection;
  repo: Repo | null;
  /** Called when the reader interacts with this section's header, so the ToC can highlight it. */
  onActivate?: () => void;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);

  // Server guarantees the 5 known kinds, but fall back to the payload's own
  // title if an unexpected kind ever arrives (next-intl throws on a missing key).
  const key = `section.${section.kind}`;
  const title = t.has(key) ? t(key) : section.title;

  const BadgeIcon = Icon[sectionIcon(section.kind)];
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <section id={sectionAnchorId(section.kind)} data-kind={section.kind} style={s.card}>
      <button
        style={s.cardHeader}
        onClick={() => {
          setOpen((o) => !o);
          onActivate?.();
        }}
        aria-expanded={open}
        aria-label={open ? t("aria.collapse") : t("aria.expand")}
      >
        <span style={s.iconBadge}>
          <BadgeIcon size={16} />
        </span>
        <h2 style={s.cardTitle}>{title}</h2>
        <span style={s.chevron}>
          <Chevron size={18} />
        </span>
      </button>

      {open && <div style={s.cardBody}>{renderBody(section, repo, t)}</div>}
    </section>
  );
}

/** Dispatch to the per-kind body renderer; each one degrades to the Markdown body
   when its structured data (links / commands) is missing. */
function renderBody(
  section: OnboardingSection,
  repo: Repo | null,
  t: ReturnType<typeof useTranslations>,
) {
  switch (section.kind) {
    case "architecture":
      return <ArchitectureBody section={section} />;
    case "critical-paths":
      return <CriticalPathsBody section={section} repo={repo} t={t} />;
    case "reading-path":
      return <ReadingPathBody section={section} />;
    case "run-locally":
      return <RunLocallyBody section={section} t={t} />;
    default:
      // first-tasks + any unknown kind: Markdown body (+ links if present).
      return <DefaultBody section={section} repo={repo} />;
  }
}

/** architecture: Markdown body + optional Mermaid diagram (unchanged behavior). */
function ArchitectureBody({ section }: { section: OnboardingSection }) {
  const diagram = section.diagram ?? null;
  return (
    <>
      <Markdown>{section.body}</Markdown>
      {diagram && (
        <div style={s.diagram}>
          <MermaidDiagram chart={diagram} />
        </div>
      )}
    </>
  );
}

/** critical-paths: one row per link (file icon + path + description + Open), else
   fall back to the Markdown body. */
function CriticalPathsBody({
  section,
  repo,
  t,
}: {
  section: OnboardingSection;
  repo: Repo | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (section.links.length === 0) return <Markdown>{section.body}</Markdown>;
  return (
    <div style={s.rows}>
      {section.links.map((link) => (
        <PathRow key={`${link.path}:${link.label}`} link={link} repo={repo} t={t} />
      ))}
    </div>
  );
}

function PathRow({
  link,
  repo,
  t,
}: {
  link: OnboardingLink;
  repo: Repo | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const url = fileUrl(repo, link.path);
  return (
    <div style={s.pathRow}>
      <span style={s.rowIcon}>
        <Icon.FileText size={15} />
      </span>
      <div style={s.rowMain}>
        <span style={s.rowPath}>{link.path}</span>
        {link.label && <span style={s.rowDesc}>— {link.label}</span>}
      </div>
      <span style={s.rowAction}>
        <Button
          kind="secondary"
          size="sm"
          icon="ExternalLink"
          disabled={!url}
          // Untrusted paths never touch an href directly: url is built by
          // githubBlobUrl (safe host, pinned branch). noopener/noreferrer set.
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
        >
          {t("open")}
        </Button>
      </span>
    </div>
  );
}

/** reading-path: numbered rows in server order (accent number badge + path +
   muted description), else fall back to the Markdown body. */
function ReadingPathBody({ section }: { section: OnboardingSection }) {
  if (section.links.length === 0) return <Markdown>{section.body}</Markdown>;
  return (
    <div style={s.rows}>
      {section.links.map((link, i) => (
        <div key={`${link.path}:${link.label}`} style={s.readingRow}>
          <span style={s.numBadge}>{i + 1}</span>
          <div style={s.readingText}>
            <span style={s.readingPath}>{link.path}</span>
            {link.label && <span style={s.readingDesc}>{link.label}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** run-locally: numbered, copyable command rows sourced from the structured
   `commands` field when present, else from the legacy first-fenced-code-block
   parse of the body; the surrounding narration renders as Markdown above the
   rows. With neither signal, the body degrades to plain Markdown. Every other
   section kind ignores `commands` entirely. */
function RunLocallyBody({
  section,
  t,
}: {
  section: OnboardingSection;
  t: ReturnType<typeof useTranslations>;
}) {
  const parsed = resolveCommands(section);
  if (!parsed) return <Markdown>{section.body}</Markdown>;
  return (
    <>
      {parsed.prose && (
        <div style={s.prose}>
          <Markdown>{parsed.prose}</Markdown>
        </div>
      )}
      <div style={s.rows}>
        {parsed.commands.map((cmd, i) => (
          <CommandRow key={`${i}:${cmd}`} index={i + 1} command={cmd} t={t} />
        ))}
      </div>
    </>
  );
}

function CommandRow({
  index,
  command,
  t,
}: {
  index: number;
  command: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = () => {
    void navigator.clipboard?.writeText(command);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={s.cmdRow}>
      <span style={s.cmdNum}>{index}</span>
      <code style={s.cmdText}>{command}</code>
      <IconBtn
        icon={copied ? "Check" : "Copy"}
        label={copied ? t("copied") : t("copy")}
        size={28}
        onClick={copy}
      />
    </div>
  );
}

/** first-tasks + unknown kinds: Markdown body, keeping any links as simple rows.
   Links go through the MonoLink primitive with a githubBlobUrl href (safe host);
   an unresolved repo yields no href, so MonoLink degrades to a plain button. */
function DefaultBody({ section, repo }: { section: OnboardingSection; repo: Repo | null }) {
  return (
    <>
      <Markdown>{section.body}</Markdown>
      {section.links.length > 0 && (
        <div style={s.links}>
          {section.links.map((link) => (
            <MonoLink key={`${link.path}:${link.label}`} href={fileUrl(repo, link.path)}>
              {link.label || link.path}
            </MonoLink>
          ))}
        </div>
      )}
    </>
  );
}
