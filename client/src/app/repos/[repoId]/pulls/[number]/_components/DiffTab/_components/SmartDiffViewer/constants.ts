import type { IconName } from "@devdigest/ui";
import type { SmartDiffRole } from "@/lib/types";

/** i18n key (under prReview.json's `smartDiff` block) for each role's section
   label. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  wiring: "smartDiff.wiringLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};

/** Icon per role, purely visual — matches no server-side meaning. */
export const ROLE_ICON: Record<SmartDiffRole, IconName> = {
  core: "Code",
  wiring: "Wrench",
  boilerplate: "Boxes",
};
