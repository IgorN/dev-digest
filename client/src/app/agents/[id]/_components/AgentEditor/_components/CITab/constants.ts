import type { CiFailOn } from "@devdigest/shared";

/**
 * The `Fail CI on` segmented control's three options, in the design's order
 * (`screen_agents.jsx:129`). `CiFailOn` has a FOURTH member — `any` — that this
 * surface deliberately does not offer: when an agent stores `any`, no option
 * renders active and the stored value is left untouched rather than silently
 * rewritten (spec edge case, AC-59).
 */
export const FAIL_ON_OPTIONS: readonly { value: CiFailOn; labelKey: string }[] = [
  { value: "critical", labelKey: "failOn.critical" },
  { value: "warning", labelKey: "failOn.warning" },
  { value: "never", labelKey: "failOn.never" },
];
