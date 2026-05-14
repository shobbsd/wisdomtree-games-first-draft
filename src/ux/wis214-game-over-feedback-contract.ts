export const WIS214_GAME_OVER_TIMING_MS = Object.freeze({
  eliminationImpact: 1_200,
  eliminationActionsTimeout: 6_000,
} as const);

export const WIS214_GAME_OVER_COPY = Object.freeze({
  elimination: Object.freeze({
    headline: "Eliminated",
    helper: "You can spectate now or view results.",
    autoRouteCta: "View Results",
    actionOutcome: Object.freeze({
      VIEW_RESULTS: "Open results now to review final placement and leaderboard outcome.",
      VIEW_LEADERBOARD: "Open results now with leaderboard rows focused by placement.",
      SPECTATE: "Enter spectator mode and keep watching current match.",
    }),
  }),
  postMatch: Object.freeze({
    guidance: "Choose your next step. You can rematch now or leave the room.",
    blockedGuidance:
      "Acknowledge leaderboard sync warning first. Rematch and routing unlock immediately after acknowledgement.",
    actionOutcome: Object.freeze({
      REPLAY_MATCH: "Start rematch ready-check in same lobby and respawn all players when countdown begins.",
      BACK_TO_LOBBY: "Return to lobby roster without exiting current room.",
      EXIT_TO_MENU: "Leave room and clear rematch intent.",
    }),
  }),
} as const);
