import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink, type TelemetryEvent } from "../src/telemetry/event-sink";
import { WIS135_RISING_GROUND_EVENT_NAMES } from "../src/ux/wis135-rising-ground-contract";

interface CanonicalRuntimeEvent {
  type: string;
  playerId: string;
  markerMs: number;
}

const CANONICAL_EVENT_TYPES = [
  WIS135_RISING_GROUND_EVENT_NAMES.normalEnter,
  WIS135_RISING_GROUND_EVENT_NAMES.warningEnter,
  WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter,
  WIS135_RISING_GROUND_EVENT_NAMES.deescalate,
  WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered,
  WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown,
  WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute,
] as const;

function toCanonicalRuntimeEvents(events: TelemetryEvent[]): CanonicalRuntimeEvent[] {
  return events
    .filter((event) => CANONICAL_EVENT_TYPES.includes(event.type as (typeof CANONICAL_EVENT_TYPES)[number]))
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      const playerId = String(payload.playerId ?? "unknown");
      const markerMs = Number(
        payload.serverTs ?? payload.shownAtMs ?? payload.elapsedMs ?? payload.nowMs ?? payload.recordedAt ?? 0,
      );

      return {
        type: event.type,
        playerId,
        markerMs,
      };
    });
}

function runDeterministicEscalationTape(sessionId: string): CanonicalRuntimeEvent[] {
  const eventSink = new InMemoryEventSink();
  const leaderboard = new LeaderboardService({ eventSink });
  const sessions = new SessionManager({ eventSink, leaderboard });

  sessions.createRoom({ sessionId, nowMs: 0 });
  sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 6 });
  sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 1 }, 20);

  const jitteredDeltas = [
    20, 30, 50,
    400, 500, 700,
    900, 500, 500,
    600, 1_000, 1_400,
    50, 50,
    2_000, 2_000, 3_100,
  ];

  let nowMs = 20;
  for (const deltaMs of jitteredDeltas) {
    nowMs += deltaMs;
    sessions.advanceRoom(sessionId, deltaMs, nowMs);
    if (nowMs === 3_620) {
      sessions.submitInput(sessionId, "alpha", { sequence: 2, thrust: -1 }, nowMs + 1);
    }
  }

  return toCanonicalRuntimeEvents(eventSink.list());
}

describe("WIS-209 rising-ground determinism", () => {
  it("replays identical escalation/elimination event sequence for identical input tape", () => {
    const firstRun = runDeterministicEscalationTape("room-wis209-a");
    const secondRun = runDeterministicEscalationTape("room-wis209-b");

    expect(firstRun).toEqual(secondRun);
    expect(firstRun.map((event) => event.type)).toEqual([
      WIS135_RISING_GROUND_EVENT_NAMES.normalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.warningEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute,
    ]);
  });

  it("does not skip warning/critical before elimination under jittered server ticks", () => {
    const events = runDeterministicEscalationTape("room-wis209-c");
    const types = events.map((event) => event.type);

    expect(types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.warningEnter)).toBeGreaterThanOrEqual(0);
    expect(types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter)).toBeGreaterThanOrEqual(0);
    expect(types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered)).toBeGreaterThanOrEqual(0);
    expect(types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.warningEnter)).toBeLessThan(
      types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter),
    );
    expect(types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter)).toBeLessThan(
      types.indexOf(WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered),
    );
  });

  it("uses canonical player-id tie-break for simultaneous ground eliminations", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-wis209-tie-break", nowMs: 0 });
    sessions.joinRoom("room-wis209-tie-break", "zeta", { nowMs: 10, spawnHeight: 1.2 });
    sessions.joinRoom("room-wis209-tie-break", "alpha", { nowMs: 20, spawnHeight: 1.2 });

    sessions.submitInput("room-wis209-tie-break", "zeta", { sequence: 1, thrust: 0 }, 30);
    sessions.submitInput("room-wis209-tie-break", "alpha", { sequence: 1, thrust: 0 }, 31);
    sessions.advanceRoom("room-wis209-tie-break", 1_000, 1_050);

    const elimination = eventSink
      .list()
      .find((event) => event.type === WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered);

    expect((elimination?.payload as { playerId?: string } | undefined)?.playerId).toBe("alpha");
  });
});
