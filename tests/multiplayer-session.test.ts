import { describe, expect, it } from "vitest";

import { MultiplayerSession } from "../src/core/multiplayer-session";

describe("MultiplayerSession", () => {
  it("advances rising ground deterministically and eliminates grounded players", () => {
    const session = new MultiplayerSession({
      sessionId: "room-1",
      groundStartSpeed: 1,
      groundAccelerationPerSecond: 0.5,
      groundMaxSpeed: 5,
    });

    session.joinPlayer("safe", { spawnHeight: 5, nowMs: 0 });
    session.joinPlayer("elim", { spawnHeight: 1.4, nowMs: 0 });

    session.submitInput("safe", { sequence: 1, thrust: 0 });
    session.submitInput("elim", { sequence: 1, thrust: 0 });

    session.tick(1000);

    const snapshot = session.getSnapshot();
    const safePlayer = snapshot.players.find((player) => player.playerId === "safe");
    const elimPlayer = snapshot.players.find((player) => player.playerId === "elim");

    expect(snapshot.world.groundRiseSpeed).toBeCloseTo(1.5, 5);
    expect(snapshot.world.groundHeight).toBeCloseTo(1.5, 5);
    expect(safePlayer?.isEliminated).toBe(false);
    expect(elimPlayer?.isEliminated).toBe(true);
  });

  it("accepts only strictly contiguous input sequences", () => {
    const session = new MultiplayerSession({ sessionId: "room-2" });

    session.joinPlayer("player-1", { nowMs: 0 });

    expect(session.submitInput("player-1", { sequence: 1, thrust: 0.1 })).toEqual({
      accepted: true,
    });

    expect(session.submitInput("player-1", { sequence: 1, thrust: 0.4 })).toEqual({
      accepted: false,
      reason: "stale",
    });

    expect(session.submitInput("player-1", { sequence: 3, thrust: 0.2 })).toEqual({
      accepted: false,
      reason: "out_of_order",
    });

    expect(session.submitInput("player-1", { sequence: 2, thrust: -0.2 })).toEqual({
      accepted: true,
    });
  });

  it("supports reconnect tokens within grace period only", () => {
    const session = new MultiplayerSession({
      sessionId: "room-3",
      reconnectGraceMs: 3_000,
    });

    session.joinPlayer("player-1", { nowMs: 0 });

    const disconnect = session.disconnectPlayer("player-1", 1_000);
    const reconnect = session.reconnectPlayer(disconnect.resumeToken, 2_000);

    expect(reconnect.connected).toBe(true);

    const disconnectAgain = session.disconnectPlayer("player-1", 4_000);
    const lateReconnect = session.reconnectPlayer(disconnectAgain.resumeToken, 7_100);

    expect(lateReconnect.connected).toBe(false);
    expect(lateReconnect.reason).toBe("token_expired");
  });
});
