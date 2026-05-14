export const WIS97_CRITICAL_MICROCOPY_BY_KEY = Object.freeze({
  "pre_match.countdown.start_3": "Match starts in 3",
  "pre_match.countdown.start_2": "Match starts in 2",
  "pre_match.countdown.start_1": "Match starts in 1",
  "pre_match.countdown.go": "Go! Stay above the rising ground",
  "in_run.eliminated.finalizing_placement": "Eliminated. Finalizing your placement",
  "in_run.eliminated.reason_rising_ground": "Rising ground caught you",
  "in_run.eliminated.reason_out_of_bounds": "You fell out of bounds",
  "in_run.hud.rank_up_now": "Rank up: now",
  "in_run.hud.rank_down_now": "Rank down: now",
  "in_run.reconnect.restoring_state": "Reconnecting... restoring live match state",
  "in_run.reconnect.sync_complete": "Reconnected. Sync complete",
  "in_run.reconnect.failed_to_results": "Reconnect failed. You have been moved to results",
  "post_match.results.complete": "Match complete. Final standings are in",
  "post_match.results.placement": "Your placement is #<rank>",
} as const);

export type Wis97CriticalMicrocopyKey = keyof typeof WIS97_CRITICAL_MICROCOPY_BY_KEY;

