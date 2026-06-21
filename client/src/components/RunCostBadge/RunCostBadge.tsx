"use client";

import { formatCost } from "@/lib/cost";

function formatTokens(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const baseStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

/**
 * RunCostBadge — three variants:
 *   compact      "$0.012"                  (PR list COST column)
 *   full         "$0.014 · 8.2K→1.3K"     (PR detail verdict panel)
 *   tokens-cost  "9,119 tok · $0.0013"    (run timeline row)
 */
export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "full" | "tokens-cost";
}) {
  if (costUsd == null) {
    return <span style={baseStyle}>—</span>;
  }

  const costStr = formatCost(costUsd);

  if (variant === "compact") {
    return <span style={baseStyle}>{costStr}</span>;
  }

  if (variant === "tokens-cost") {
    const total = (tokensIn ?? 0) + (tokensOut ?? 0);
    return (
      <span style={baseStyle}>
        {total.toLocaleString()} tok · {costStr}
      </span>
    );
  }

  const detail =
    tokensIn != null || tokensOut != null
      ? ` · ${formatTokens(tokensIn)}→${formatTokens(tokensOut)}`
      : "";

  return (
    <span style={baseStyle}>
      {costStr}
      {detail}
    </span>
  );
}
