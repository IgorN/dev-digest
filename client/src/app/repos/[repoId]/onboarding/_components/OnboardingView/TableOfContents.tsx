/* "On this page" sidebar: lists the tour's section titles and smooth-scrolls to
   one on click.

   The active item is CONTROLLED by the parent and changes only on an explicit
   action — clicking an entry here, or clicking a section header. Deliberately
   NOT a scroll-spy: "which section is the reader on" is genuinely ambiguous when
   sections differ wildly in height. Two heuristics were tried and each traded
   one wrong highlight for another — a reading-line threshold never let the
   trailing sections activate (no scroll room left at the end of the page), and
   largest-visible-area let one tall diagram section starve every short one.
   Explicit selection has no such edge cases and needs no effects. */
"use client";

import { sectionAnchorId } from "./helpers";
import { s } from "./styles";

type TocItem = { kind: string; label: string };

export function TableOfContents({
  items,
  label,
  active,
  onSelect,
}: {
  items: TocItem[];
  label: string;
  active: string | null;
  onSelect: (kind: string) => void;
}) {
  if (items.length === 0) return null;

  const jump = (kind: string) => {
    onSelect(kind);
    // jsdom lacks scrollIntoView — optional-chain so tests don't throw.
    document.getElementById(sectionAnchorId(kind))?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <nav style={s.toc} aria-label={label}>
      <div style={s.tocLabel}>{label}</div>
      <div style={s.tocList}>
        {items.map((it) => (
          <button
            key={it.kind}
            style={{ ...s.tocItem, ...(it.kind === active ? s.tocItemActive : {}) }}
            aria-current={it.kind === active ? "true" : undefined}
            onClick={() => jump(it.kind)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
