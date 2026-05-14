import { describe, expect, it } from "vitest";

import { chooseBotThrust, shouldCompleteRound } from "../src/playable/runtime-helpers";
import type { PlayerSnapshot } from "../src/types";

function makePlayer(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    playerId: "bot",
    height: 1,
    velocity: 0,
    connected: true,
    reconnectExpiresAtMs: null,
    isEliminated: false,
    eliminationReason: null,
    lastInputSequence: 1,
    survivalMs: 2_000,
    ...overrides,
  };
}

describe("playable runtime helpers", () => {
  it("commands full lift when bot is too close to ground", () => {
    const thrust = chooseBotThrust(makePlayer({ height: 0.45, velocity: -0.2 }), 0.2);
    expect(thrust).toBe(1);
  });

  it("commands descent when bot is very safe and drifting upward", () => {
    const thrust = chooseBotThrust(makePlayer({ height: 3.2, velocity: 0.6 }), 0.2);
    expect(thrust).toBe(-0.2);
  });

  it("stops thrust when bot is unavailable", () => {
    expect(chooseBotThrust(undefined, 0)).toBe(0);
    expect(chooseBotThrust(makePlayer({ connected: false }), 0)).toBe(0);
    expect(chooseBotThrust(makePlayer({ isEliminated: true }), 0)).toBe(0);
  });

  it("ends round on max ticks or when all players are eliminated", () => {
    const active = [makePlayer({ playerId: "alpha" }), makePlayer({ playerId: "beta", isEliminated: true })];
    expect(shouldCompleteRound(active, 5, 10)).toBe(false);

    const everyoneDown = active.map((player) => ({ ...player, isEliminated: true }));
    expect(shouldCompleteRound(everyoneDown, 5, 10)).toBe(true);
    expect(shouldCompleteRound(active, 10, 10)).toBe(true);
  });
});
