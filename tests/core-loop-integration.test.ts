import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

describe("core loop integration", () => {
  it("creates a room, advances simulation, and publishes final standings", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    const room = sessions.createRoom({ sessionId: "room-int", nowMs: 0 });

    sessions.joinRoom(room.sessionId, "alpha", { spawnHeight: 6, nowMs: 0 });
    sessions.joinRoom(room.sessionId, "beta", { spawnHeight: 5, nowMs: 0 });

    sessions.submitInput(room.sessionId, "alpha", { sequence: 1, thrust: 0.2 });
    sessions.submitInput(room.sessionId, "beta", { sequence: 1, thrust: 0.1 });

    sessions.advanceRoom(room.sessionId, 500);
    sessions.advanceRoom(room.sessionId, 500);

    const ingestion = sessions.completeRoom(room.sessionId, { recordedAt: 1_500 });
    const standings = leaderboard.getStandings();

    expect(ingestion.sessionId).toBe("room-int");
    expect(ingestion.commits).toHaveLength(2);
    expect(ingestion.commits.every((commit) => commit.rankDelta === null)).toBe(true);
    expect(standings).toHaveLength(2);
    expect(new Set(standings.map((entry) => entry.playerId))).toEqual(new Set(["alpha", "beta"]));

    expect(eventSink.list({ type: "session.lifecycle.created" })).toHaveLength(1);
    expect(eventSink.list({ type: "leaderboard.write" })).toHaveLength(1);
  });
});
