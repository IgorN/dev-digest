/* Literals shared by every surface of the Multi-Agent Review route tree
   (Configure-run form, result view in both modes, disagreement block).

   AC-52 — accent colours are assigned by POSITION in the multi-run's agent
   order, never stored per agent: the first four lanes take red / amber / blue /
   purple (the design gallery's persona palette), and a fifth lane and beyond
   fall through to a neutral grey. That buys zero schema change and no
   migration, at the accepted cost that the same agent can read red in one
   multi-run and amber in another. */
export const AGENT_ACCENTS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"] as const;

/** Fifth lane onwards — deliberately neutral, so the palette never wraps. */
export const AGENT_ACCENT_FALLBACK = "var(--text-muted)";

/** Agents carry no icon field, so every lane renders the same Cpu glyph. */
export const AGENT_ICON = "Cpu" as const;

/** Columns mode lays out at most this many equal columns before scrolling. */
export const MAX_COLUMNS = 5;

/** Explicit address of the Configure-run form (AC-22c, AC-33a). */
export const CONFIGURE_HREF = "/multi-agent-review/configure";
