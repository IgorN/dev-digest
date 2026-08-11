import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@/lib/types";

/** Risk-severity -> {colour, background, icon}, local to PrBriefCard (not a
   shared @devdigest/ui primitive — this is the only consumer today). Colour
   is always paired with an icon + a translated text label at the call site
   (never colour alone, AC-15). Uses the same --crit/--warn/--ok CSS
   variables already defined in both themes: client/src/vendor/ui/styles.css. */
export const RISK_LEVEL: Record<RiskSeverity, { c: string; bg: string; icon: IconName }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};
