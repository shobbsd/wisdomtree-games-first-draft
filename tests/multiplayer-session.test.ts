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

  it("applies configured rising-ground speed curve and clamps at max speed", () => {
    const session = new MultiplayerSession({
      sessionId: "room-speed-curve",
      groundStartSpeed: 1,
      groundAccelerationPerSecond: 0.5,
      groundMaxSpeed: 2,
    });

    session.joinPlayer("pilot", { spawnHeight: 50, nowMs: 0 });
    session.submitInput("pilot", { sequence: 1, thrust: 0 }, 0);

    session.tick(1_000);
    expect(session.getSnapshot().world.groundRiseSpeed).toBeCloseTo(1.5, 6);

    session.tick(1_000);
    expect(session.getSnapshot().world.groundRiseSpeed).toBeCloseTo(2, 6);

    session.tick(1_000);
    const snapshot = session.getSnapshot();

    expect(snapshot.world.groundRiseSpeed).toBeCloseTo(2, 6);
    expect(snapshot.world.groundHeight).toBeCloseTo(5.5, 6);
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

  it("rejects impossible input envelope before sequence/rate processing", () => {
    const session = new MultiplayerSession({ sessionId: "room-input-envelope" });
    session.joinPlayer("alpha", { nowMs: 0 });

    expect(session.submitInput("alpha", { sequence: 0, thrust: 0.1 }, 10)).toEqual({
      accepted: false,
      reason: "impossible_input",
    });
    expect(session.submitInput("alpha", { sequence: 1, thrust: Number.NaN }, 20)).toEqual({
      accepted: false,
      reason: "impossible_input",
    });
    expect(session.submitInput("alpha", { sequence: 1, thrust: 0.2 }, 30)).toEqual({
      accepted: true,
    });
  });

  it("supports reconnect tokens within grace period only", () => {
    const session = new MultiplayerSession({
      sessionId: "room-3",
      reconnectGraceMs: 3_000,
      reconnectTokenSecret: "test-secret",
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

  it("rejects replayed reconnect tokens after successful reconnect", () => {
    const session = new MultiplayerSession({
      sessionId: "room-3b",
      reconnectGraceMs: 3_000,
      reconnectTokenSecret: "test-secret",
    });

    session.joinPlayer("player-1", { nowMs: 0 });

    const disconnect = session.disconnectPlayer("player-1", 1_000);
    expect(session.reconnectPlayer(disconnect.resumeToken, 2_000)).toEqual({
      connected: true,
      playerId: "player-1",
    });

    expect(session.reconnectPlayer(disconnect.resumeToken, 2_100)).toEqual({
      connected: false,
      reason: "token_replayed",
      playerId: "player-1",
    });
  });

  it("rejects reconnect tokens with invalid signatures", () => {
    const session = new MultiplayerSession({
      sessionId: "room-3c",
      reconnectGraceMs: 3_000,
      reconnectTokenSecret: "test-secret",
    });

    session.joinPlayer("player-1", { nowMs: 0 });
    const disconnect = session.disconnectPlayer("player-1", 1_000);
    const tamperedToken = disconnect.resumeToken.endsWith("a")
      ? `${disconnect.resumeToken.slice(0, -1)}b`
      : `${disconnect.resumeToken.slice(0, -1)}a`;

    expect(session.reconnectPlayer(tamperedToken, 2_000)).toEqual({
      connected: false,
      reason: "unknown_token",
    });
  });

  it("enforces player and room input abuse limits", () => {
    const session = new MultiplayerSession({
      sessionId: "room-rate",
      playerInputRateLimitPerSecond: 2,
      roomInputRateLimitPerSecond: 3,
      inputRateWindowMs: 1_000,
    });

    session.joinPlayer("alpha", { nowMs: 0 });
    session.joinPlayer("beta", { nowMs: 0 });

    expect(session.submitInput("alpha", { sequence: 1, thrust: 0.1 }, 0)).toEqual({
      accepted: true,
    });
    expect(session.submitInput("alpha", { sequence: 2, thrust: 0.2 }, 10)).toEqual({
      accepted: true,
    });
    expect(session.submitInput("alpha", { sequence: 3, thrust: 0.3 }, 20)).toEqual({
      accepted: false,
      reason: "rate_limited_player",
    });

    expect(session.submitInput("beta", { sequence: 1, thrust: 0.1 }, 30)).toEqual({
      accepted: true,
    });
    expect(session.submitInput("beta", { sequence: 2, thrust: 0.2 }, 40)).toEqual({
      accepted: false,
      reason: "rate_limited_room",
    });

    expect(session.submitInput("beta", { sequence: 2, thrust: 0.2 }, 1_100)).toEqual({
      accepted: true,
    });
  });

  it("resolves reconnect grace expiry as disconnected elimination", () => {
    const session = new MultiplayerSession({
      sessionId: "room-4",
      reconnectGraceMs: 3_000,
    });

    session.joinPlayer("player-1", { nowMs: 0, spawnHeight: 10 });

    const disconnect = session.disconnectPlayer("player-1", 1_000);
    const expired = session.resolveExpiredReconnects(4_001);

    expect(expired).toEqual([
      {
        playerId: "player-1",
        expiredAtMs: disconnect.expiresAtMs,
      },
    ]);

    const snapshot = session.getSnapshot();
    const player = snapshot.players.find((entry) => entry.playerId === "player-1");

    expect(player).toMatchObject({
      connected: false,
      isEliminated: true,
      eliminationReason: "disconnected",
    });
  });

  it("records movement integrity violations when kinematic caps are exceeded", () => {
    const session = new MultiplayerSession({
      sessionId: "room-movement-integrity",
      integrityConfig: {
        movementHeightSlackUnits: -4,
        movementVelocitySlackPct: -0.9,
      },
    });

    session.joinPlayer("pilot", { nowMs: 0, spawnHeight: 20 });
    session.submitInput("pilot", { sequence: 1, thrust: 1 }, 10);
    session.tick(1_000);

    const ruleIds = session.drainIntegrityViolations().map((violation) => violation.ruleId);
    expect(ruleIds).toContain("MOV-001");
    expect(ruleIds).toContain("MOV-002");
  });
});
