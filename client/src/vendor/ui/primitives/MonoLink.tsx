import React from "react";

export function MonoLink({
  children,
  onClick,
  href,
  accent,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  /** When set, renders an anchor that opens in a new tab (middle-click works). */
  href?: string;
  /** Renders `var(--accent-text)` by default instead of only on hover — for
   *  a context where the link should read as prominent/actionable at a
   *  glance (e.g. PrBriefCard's review-focus rows), not just on interaction. */
  accent?: boolean;
}) {
  const [h, setH] = React.useState(false);
  const style: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    cursor: "pointer",
    color: h || accent ? "var(--accent-text)" : "var(--text-secondary)",
    textDecoration: h ? "underline" : "none",
    textUnderlineOffset: 2,
  };

  if (href) {
    return (
      <a
        className="mono"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      className="mono"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={style}
    >
      {children}
    </button>
  );
}
