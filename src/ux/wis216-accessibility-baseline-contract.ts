import type { Wis135RisingGroundRuntimeState } from "./wis135-rising-ground-contract.js";

type ResultsLifecycleState = "RESULTS-NORMAL" | "RESULTS-PENDING" | "RESULTS-RETRYING" | "RESULTS-FAILED";

type LiveRegionPolicy = {
  politeness: "off" | "polite" | "assertive";
  role: "none" | "status" | "alert";
  ariaAtomic: boolean;
};

interface ResolveAnnouncementPolicyInput {
  uxStateId?: string;
  risingGroundState?: Wis135RisingGroundRuntimeState;
  resultsLifecycleState?: ResultsLifecycleState;
  hasRecoveryToast?: boolean;
}

export const WIS216_ACCESSIBILITY_BASELINE = Object.freeze({
  contrastMinimums: Object.freeze({
    textRatio: 4.5,
    nonTextRatio: 3,
  }),
  dualSignalEncoding: Object.freeze({
    required: true,
    channels: Object.freeze(["icon", "label", "body_copy"]),
  }),
  typographyMinimumsPx: Object.freeze({
    hudField: 18,
    hudCritical: 20,
    resultsStatus: 18,
    actionLabel: 18,
  }),
  reducedMotion: Object.freeze({
    supportsPrefersReducedMotion: true,
    reducedPreset: Object.freeze({
      transitionProperty: "opacity",
      maxDurationMs: 150,
      pulseAllowed: false,
      transformMotionAllowed: false,
    }),
  }),
  liveRegions: Object.freeze({
    passive: Object.freeze({
      politeness: "off",
      role: "none",
      ariaAtomic: false,
    }),
    nonCritical: Object.freeze({
      politeness: "polite",
      role: "status",
      ariaAtomic: true,
    }),
    critical: Object.freeze({
      politeness: "assertive",
      role: "alert",
      ariaAtomic: true,
    }),
  }),
  focusOrder: Object.freeze({
    eliminationActions: Object.freeze(["elimination_heading", "primary_action", "secondary_action"]),
    resultsActions: Object.freeze(["results_heading", "primary_action", "secondary_action", "tertiary_action"]),
    resultsFailureAlert: Object.freeze(["results_failure_heading", "acknowledge_button", "view_details_button"]),
  }),
  acceptanceChecks: Object.freeze([
    Object.freeze({
      id: "A11Y-216-01",
      assertion: "Critical HUD and failed results states emit assertive alert semantics on first render.",
    }),
    Object.freeze({
      id: "A11Y-216-02",
      assertion: "Pending/retrying/recovery result states emit polite status semantics for assistive tech.",
    }),
    Object.freeze({
      id: "A11Y-216-03",
      assertion: "Reduced-motion mode restricts transitions to opacity-only with max 150ms duration.",
    }),
    Object.freeze({
      id: "A11Y-216-04",
      assertion: "Focus order stays deterministic across elimination actions and post-match action surfaces.",
    }),
  ]),
});

const PASSIVE_POLICY: LiveRegionPolicy = WIS216_ACCESSIBILITY_BASELINE.liveRegions.passive;
const NON_CRITICAL_POLICY: LiveRegionPolicy = WIS216_ACCESSIBILITY_BASELINE.liveRegions.nonCritical;
const CRITICAL_POLICY: LiveRegionPolicy = WIS216_ACCESSIBILITY_BASELINE.liveRegions.critical;

export type Wis216LiveRegionPolicy = LiveRegionPolicy;

export function resolveWis216AnnouncementPolicy(input: ResolveAnnouncementPolicyInput): Wis216LiveRegionPolicy {
  if (input.resultsLifecycleState === "RESULTS-FAILED") {
    return CRITICAL_POLICY;
  }

  if (
    input.resultsLifecycleState === "RESULTS-PENDING" ||
    input.resultsLifecycleState === "RESULTS-RETRYING" ||
    input.hasRecoveryToast
  ) {
    return NON_CRITICAL_POLICY;
  }

  if (input.uxStateId === "HUD-ELIMINATED" || input.risingGroundState === "RG-CRITICAL") {
    return CRITICAL_POLICY;
  }

  if (input.uxStateId === "HUD-RECONNECTING" || input.risingGroundState === "RG-WARNING") {
    return NON_CRITICAL_POLICY;
  }

  return PASSIVE_POLICY;
}
