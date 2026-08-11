/* ContextTab — attach/detach the active repo's context documents (markdown
   under specs/docs/insights) to a skill, and drag to reorder. Every agent
   using this skill inherits the attached documents; at run time they are
   injected — as an untrusted "## Project context" block — in this order.
   Every change persists the full ordered path set (mirrors the agent editor's
   Skills tab). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, EmptyState, Icon, IconBtn, Markdown, Skeleton } from "@devdigest/ui";
import type { Skill, DocumentInventoryItem } from "@devdigest/shared";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import {
  useContextInventory,
  useContextDocumentPreview,
  useSetSkillContextDocuments,
} from "../../../../../../../lib/hooks/context";
import { fileName, folderPath, reorder, rootBadge, sumTokens } from "./helpers";
import { s } from "./styles";

/** One attachable document row. A real component (not a render fn) so React
    can reconcile it across drag-state / filter changes without remounting. */
function DocRow({
  item,
  attached,
  dragging,
  previewOpen,
  onToggle,
  onTogglePreview,
  onDragStart,
  onDrop,
  onDragEnd,
  dragHint,
  previewLabel,
  tokensLabel,
}: {
  item: DocumentInventoryItem;
  attached: boolean;
  dragging: boolean;
  previewOpen: boolean;
  onToggle: () => void;
  onTogglePreview: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  dragHint: string;
  previewLabel: string;
  tokensLabel: string;
}) {
  // The root badge already says e.g. "specs" — only show the dir text when it
  // carries MORE information than that (a nested path), never a bare repeat.
  const dirRaw = folderPath(item.path);
  const dir = dirRaw !== item.root ? dirRaw : "";
  const badge = rootBadge(item.root);
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
      <span style={s.rowText}>
        <span className="mono" style={s.name}>
          {fileName(item.path)}
        </span>
        {dir && <span style={s.dir}>{dir}</span>}
      </span>
      <span className="tnum" style={s.tokens}>
        {tokensLabel}
      </span>
      <Badge color={badge.color} bg={badge.bg} mono>
        {item.root}
      </Badge>
      <IconBtn icon={previewOpen ? "EyeOff" : "Eye"} label={previewLabel} size={26} active={previewOpen} onClick={onTogglePreview} />
    </div>
  );
}

/** Inline read-only preview of one document. Untrusted repo markdown is
    rendered through the sanitizing @devdigest/ui Markdown primitive. */
function DocPreview({ repoId, path }: { repoId: string; path: string }) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useContextDocumentPreview(repoId, path);
  if (isLoading) {
    return (
      <div style={s.previewLoading}>
        <Skeleton height={14} width="60%" />
        <Skeleton height={80} />
      </div>
    );
  }
  if (isError || !data) return <div style={s.previewError}>{t("preview.loadError")}</div>;
  return (
    <div style={s.preview}>
      <Markdown>{data.content}</Markdown>
    </div>
  );
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const { data: inventory, isLoading } = useContextInventory(repoId);
  const setDocs = useSetSkillContextDocuments(skill.id);

  // Local ordered list of ATTACHED document paths, seeded from the skill.
  const [attached, setAttached] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState("");
  const [dragPath, setDragPath] = React.useState<string | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAttached(skill.context_documents ?? []);
  }, [skill.context_documents]);

  const persist = (next: string[]) => {
    setAttached(next);
    setDocs.mutate(next);
  };

  const byPath = React.useMemo(() => {
    const m = new Map<string, DocumentInventoryItem>();
    for (const item of inventory?.items ?? []) m.set(item.path, item);
    return m;
  }, [inventory]);

  // Ordered render list: attached (in order) first, then the rest. `persist`
  // always operates on the `attached` path array (not this filtered view), so
  // a stale attached path missing from the inventory is never dropped.
  const attachedItems = attached
    .map((p) => byPath.get(p))
    .filter((x): x is DocumentInventoryItem => !!x);
  const restItems = (inventory?.items ?? []).filter((item) => !attached.includes(item.path));
  const q = filter.trim().toLowerCase();
  const match = (item: DocumentInventoryItem) => !q || item.path.toLowerCase().includes(q);

  const toggle = (path: string) =>
    persist(attached.includes(path) ? attached.filter((p) => p !== path) : [...attached, path]);

  const onDrop = (targetPath: string) => {
    if (!dragPath || dragPath === targetPath) return setDragPath(null);
    persist(reorder(attached, attached.indexOf(dragPath), attached.indexOf(targetPath)));
    setDragPath(null);
  };

  const total = inventory?.items.length ?? 0;
  const totalTokens = sumTokens(attached, byPath);

  const rows = (items: DocumentInventoryItem[], isAttached: boolean) =>
    items.filter(match).map((item) => (
      <React.Fragment key={item.path}>
        <DocRow
          item={item}
          attached={isAttached}
          dragging={dragPath === item.path}
          previewOpen={previewPath === item.path}
          onToggle={() => toggle(item.path)}
          onTogglePreview={() => setPreviewPath(previewPath === item.path ? null : item.path)}
          onDragStart={() => setDragPath(item.path)}
          onDrop={() => onDrop(item.path)}
          onDragEnd={() => setDragPath(null)}
          dragHint={t("tab.dragHint")}
          previewLabel={
            previewPath === item.path
              ? t("tab.hidePreview", { name: fileName(item.path) })
              : t("tab.showPreview", { name: fileName(item.path) })
          }
          tokensLabel={t("tokens", { count: item.token_estimate })}
        />
        {previewPath === item.path && repoId && <DocPreview repoId={repoId} path={item.path} />}
      </React.Fragment>
    ));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <span style={s.count}>{t("tab.attachedCount", { attached: attached.length, total })}</span>
        <div style={s.filter}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tab.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("tab.orderHint")}</p>

      {!repoId ? (
        <div style={s.empty}>{t("noRepoBody")}</div>
      ) : isLoading ? (
        <div style={s.list}>
          <Skeleton height={42} />
          <Skeleton height={42} />
          <Skeleton height={42} />
        </div>
      ) : inventory && !inventory.has_clone ? (
        /* AC-4: a repo without a local clone is an expected state, not an error. */
        <EmptyState icon="GitBranch" title={t("noClone.title")} body={t("noClone.body")} />
      ) : total === 0 ? (
        <EmptyState icon="FileText" title={t("noDocs.title")} body={t("noDocs.body")} />
      ) : (
        <>
          <div style={s.list}>
            {rows(attachedItems, true)}
            {rows(restItems, false)}
          </div>
          {/* AC-14: deterministic total for the attached set, updates on toggle. */}
          <div style={s.footer}>
            <span className="tnum">{t("tab.totalTokens", { count: totalTokens })}</span>
          </div>
        </>
      )}

      {/* Read-only view of how the attachment serializes into the prompt
          assembly for every agent using this skill. */}
      {attached.length > 0 && (
        <div style={s.serialize}>
          <div style={s.serializeLabel}>{t("tab.serializesTitle")}</div>
          <pre style={s.serializeBlock}>
            {["## Project specifications", ...attached.map((p) => `- ${p}`)].join("\n")}
          </pre>
          <p style={s.serializeHint}>{t("tab.inheritHint")}</p>
        </div>
      )}
    </div>
  );
}
