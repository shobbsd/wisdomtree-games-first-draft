export const WIS135_RISING_GROUND_EVENT_NAMES = Object.freeze({
  normalEnter: "rg.state.normal.enter",
  warningEnter: "rg.state.warning.enter",
  criticalEnter: "rg.state.critical.enter",
  deescalate: "rg.state.deescalate",
  eliminationTriggered: "rg.elimination.triggered",
  eliminationActionsShown: "rg.elimination.actions_shown",
  eliminationAutoRoute: "rg.elimination.auto_route",
} as const);

export const WIS135_RISING_GROUND_COPY = Object.freeze({
  normal: "Danger low. Keep climbing.",
  warning: "Ground rising faster. Move up.",
  critical: "Critical danger. Climb now.",
  eliminated: {
    status: "Eliminated. Finalizing your placement...",
    cause: "Rising ground caught you.",
    helper: "You can spectate now or view results.",
    actions: ["Spectate", "View Leaderboard"] as const,
  },
} as const);

export const WIS135_RISING_GROUND_TIMING_MS = Object.freeze({
  warningMinDwell: 1_500,
  criticalMinDwell: 1_800,
  eliminationImpact: 1_200,
  eliminationAutoRoute: 6_000,
  sameTierDebounce: 300,
} as const);

export type Wis135RisingGroundRuntimeState = "RG-NORMAL" | "RG-WARNING" | "RG-CRITICAL" | "RG-ELIMINATED";

export type Wis135RisingGroundDangerTier = "LOW" | "MED" | "WARNING" | "CRITICAL";

export const WIS135_RISING_GROUND_VISIBILITY = Object.freeze({
  normal: {
    desktop: "danger_rail",
    mobile: "compact_danger_row",
  },
  warning: {
    desktop: "top_status_strip",
    mobile: "top_compact_strip",
  },
  critical: {
    desktop: "top_priority_banner_lane",
    mobile: "safe_area_top_priority_banner_lane",
  },
  eliminated: {
    desktop: "full_interrupt_overlay",
    mobile: "interrupt_bottom_sheet",
  },
} as const);
