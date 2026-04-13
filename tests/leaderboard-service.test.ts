import { describe, expect, it } from "vitest";

import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

describe("LeaderboardService", () => {
  it("keeps best score per player and returns sorted standings", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      sessionId: "s-1",
      recordedAt: 1_000,
      entries: [
        { playerId: "alice", score: 12, survivalMs: 15_000 },
        { playerId: "bob", score: 22, survivalMs: 12_000 },
      ],
    });

    leaderboard.recordMatchResult({
      sessionId: "s-2",
      recordedAt: 2_000,
      entries: [
        { playerId: "alice", score: 30, survivalMs: 19_000 },
        { playerId: "bob", score: 19, survivalMs: 20_000 },
      ],
    });

    const standings = leaderboard.getStandings();

    expect(standings.map((entry) => entry.playerId)).toEqual(["alice", "bob"]);
    expect(standings[0]?.score).toBe(30);
    expect(standings[1]?.score).toBe(22);
  });

  it("emits telemetry on leaderboard writes", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      sessionId: "s-telemetry",
      recordedAt: 5_000,
      entries: [{ playerId: "racer", score: 88, survivalMs: 42_000 }],
    });

    const events = sink.list({ type: "leaderboard.write" });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      sessionId: "s-telemetry",
      entries: 1,
      topPlayerId: "racer",
      topScore: 88,
    });
  });
});
