import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { FileDurableStateStore } from "../src/persistence/file-durable-state-store";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

interface PersistedFixture {
  sessionSnapshots: Array<{ sessionId: string; phase: string; revision: number }>;
  matchFinalEvents: Array<{ eventId: string; sessionId: string; recordedAt: number }>;
}

describe("durability + replay hardening", () => {
  it("persists session snapshots and match-final events to a durable store", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis80-durable-"));
    const stateFilePath = join(fixtureDir, "state.json");

    try {
      const durableStore = new FileDurableStateStore({ filePath: stateFilePath });
      const eventSink = new InMemoryEventSink();
      const leaderboard = new LeaderboardService({ eventSink, durableStore });
      const sessions = new SessionManager({ eventSink, leaderboard, durableStore });

      sessions.createRoom({ sessionId: "room-durable", nowMs: 0 });
      sessions.joinRoom("room-durable", "alpha", { nowMs: 5, spawnHeight: 9 });
      sessions.submitInput("room-durable", "alpha", { sequence: 1, thrust: 0.2 }, 10);
      sessions.advanceRoom("room-durable", 300, 320);
      sessions.completeRoom("room-durable", { recordedAt: 700 });

      const persisted = JSON.parse(readFileSync(stateFilePath, "utf8")) as PersistedFixture;

      expect(persisted.sessionSnapshots.length).toBeGreaterThan(0);
      expect(persisted.sessionSnapshots.at(-1)).toMatchObject({
        sessionId: "room-durable",
        phase: "results",
      });
      expect(persisted.matchFinalEvents).toHaveLength(1);
      expect(persisted.matchFinalEvents[0]).toMatchObject({
        eventId: "match-final:room-durable",
        sessionId: "room-durable",
        recordedAt: 700,
      });
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("quarantines duplicate match events with mismatched payloads and preserves durable baseline", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis80-idempotent-"));
    const stateFilePath = join(fixtureDir, "state.json");

    try {
      const durableStore = new FileDurableStateStore({ filePath: stateFilePath });
      const eventSink = new InMemoryEventSink();
      const leaderboard = new LeaderboardService({ eventSink, durableStore });

      const first = leaderboard.recordMatchResult({
        eventId: "match-final:room-dup",
        sessionId: "room-dup",
        recordedAt: 100,
        entries: [{ playerId: "alpha", score: 42, survivalMs: 12_000 }],
      });
      const duplicate = leaderboard.recordMatchResult({
        eventId: "match-final:room-dup",
        sessionId: "room-dup",
        recordedAt: 101,
        entries: [{ playerId: "alpha", score: 99, survivalMs: 99_000 }],
      });

      expect(first.idempotent).toBe(false);
      expect(duplicate.idempotent).toBe(true);
      expect(leaderboard.getStandings()).toMatchObject([
        { playerId: "alpha", score: 42, survivalMs: 12_000 },
      ]);
      expect(eventSink.list({ type: "leaderboard.integrity.mismatch_quarantined" })).toHaveLength(1);

      const persisted = JSON.parse(readFileSync(stateFilePath, "utf8")) as PersistedFixture;
      expect(persisted.matchFinalEvents).toHaveLength(1);
      expect(persisted.matchFinalEvents[0]?.recordedAt).toBe(100);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("recovers standings after restart by replaying persisted match-final events", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis80-replay-"));
    const stateFilePath = join(fixtureDir, "state.json");

    try {
      const durableStore = new FileDurableStateStore({ filePath: stateFilePath });

      const firstSink = new InMemoryEventSink();
      const firstLeaderboard = new LeaderboardService({ eventSink: firstSink, durableStore });
      const firstSessions = new SessionManager({
        eventSink: firstSink,
        leaderboard: firstLeaderboard,
        durableStore,
      });

      firstSessions.createRoom({ sessionId: "room-replay", nowMs: 0 });
      firstSessions.joinRoom("room-replay", "alpha", { nowMs: 5, spawnHeight: 9 });
      firstSessions.joinRoom("room-replay", "beta", { nowMs: 6, spawnHeight: 8.5 });
      firstSessions.submitInput("room-replay", "alpha", { sequence: 1, thrust: 0.2 }, 10);
      firstSessions.submitInput("room-replay", "beta", { sequence: 1, thrust: 0.1 }, 12);
      firstSessions.advanceRoom("room-replay", 500, 520);
      firstSessions.completeRoom("room-replay", { recordedAt: 800 });

      const standingsBeforeRestart = firstLeaderboard.getStandings();

      const secondSink = new InMemoryEventSink();
      const secondLeaderboard = new LeaderboardService({
        eventSink: secondSink,
        durableStore: new FileDurableStateStore({ filePath: stateFilePath }),
      });

      expect(secondLeaderboard.getStandings()).toEqual(standingsBeforeRestart);
      expect(
        secondLeaderboard.recordMatchResult({
          eventId: "match-final:room-replay",
          sessionId: "room-replay",
          recordedAt: 900,
          entries: [{ playerId: "alpha", score: 999, survivalMs: 999_000 }],
        }).idempotent,
      ).toBe(true);
      expect(secondLeaderboard.getStandings()).toEqual(standingsBeforeRestart);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
