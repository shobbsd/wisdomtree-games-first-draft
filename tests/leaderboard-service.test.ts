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

  it("emits SLO latency/failure metrics on successful leaderboard writes", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      sessionId: "s-slo-success",
      recordedAt: 6_000,
      entries: [{ playerId: "runner", score: 77, survivalMs: 39_000 }],
    });

    const events = sink.list({ type: "leaderboard.slo.write_latency" });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      sessionId: "s-slo-success",
      success: true,
      attempts: 1,
      failures: 0,
      failureRate: 0,
      sampleSize: 1,
    });
    expect((events[0]?.payload as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
    expect((events[0]?.payload as { p95LatencyMs: number }).p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect((events[0]?.payload as { p99LatencyMs: number }).p99LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("emits SLO latency/failure metrics when leaderboard writes fail", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    const badEntry = {
      get playerId(): string {
        throw new Error("bad player id");
      },
      score: 1,
      survivalMs: 1,
    };

    expect(() =>
      leaderboard.recordMatchResult({
        sessionId: "s-slo-fail",
        recordedAt: 7_000,
        entries: [badEntry],
      }),
    ).toThrow("bad player id");

    const events = sink.list({ type: "leaderboard.slo.write_latency" });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      sessionId: "s-slo-fail",
      success: false,
      attempts: 1,
      failures: 1,
      failureRate: 1,
      sampleSize: 1,
    });
  });

  it("assigns shared tie ranks with a stable placement token", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      sessionId: "s-tie",
      recordedAt: 100,
      entries: [
        { playerId: "alice", score: 100, survivalMs: 18_000 },
        { playerId: "bob", score: 100, survivalMs: 18_000 },
        { playerId: "charlie", score: 90, survivalMs: 17_000 },
      ],
    });

    const standings = leaderboard.getStandings();

    expect(standings).toMatchObject([
      { playerId: "alice", rank: 1, isTie: true, placementToken: "T-1" },
      { playerId: "bob", rank: 1, isTie: true, placementToken: "T-1" },
      { playerId: "charlie", rank: 3, isTie: false, placementToken: "3" },
    ]);
  });

  it("keeps deterministic tie ordering across repeated runs regardless of entry order", () => {
    const permutations = [
      ["charlie", "alpha", "bravo"],
      ["bravo", "charlie", "alpha"],
      ["alpha", "bravo", "charlie"],
    ] as const;

    for (const [index, order] of permutations.entries()) {
      const sink = new InMemoryEventSink();
      const leaderboard = new LeaderboardService({ eventSink: sink });

      leaderboard.recordMatchResult({
        eventId: `match-final:room-stable-${index}`,
        sessionId: `room-stable-${index}`,
        recordedAt: 100 + index,
        entries: order.map((playerId) => ({
          playerId,
          score: 120,
          survivalMs: 33_000,
        })),
      });

      const standings = leaderboard.getStandings();
      expect(standings.map((entry) => entry.playerId)).toEqual(["alpha", "bravo", "charlie"]);
      expect(standings.every((entry) => entry.rank === 1)).toBe(true);
      expect(standings.every((entry) => entry.placementToken === "T-1")).toBe(true);
    }
  });

  it("returns per-player rank deltas in match commit output", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      sessionId: "s-seed",
      recordedAt: 100,
      entries: [
        { playerId: "alice", score: 82, survivalMs: 14_000 },
        { playerId: "bob", score: 76, survivalMs: 13_000 },
      ],
    });

    const committed = leaderboard.recordMatchResult({
      sessionId: "s-shift",
      recordedAt: 200,
      entries: [
        { playerId: "bob", score: 91, survivalMs: 18_000 },
        { playerId: "alice", score: 85, survivalMs: 15_000 },
      ],
    });

    expect(committed.commits).toEqual([
      {
        playerId: "bob",
        previousRank: 2,
        rank: 1,
        rankDelta: 1,
        isTie: false,
        placementToken: "1",
        score: 91,
        survivalMs: 18_000,
      },
      {
        playerId: "alice",
        previousRank: 1,
        rank: 2,
        rankDelta: -1,
        isTie: false,
        placementToken: "2",
        score: 85,
        survivalMs: 15_000,
      },
    ]);
  });

  it("quarantines duplicate event ids when payload fingerprint mismatches", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      eventId: "match-final:room-integrity",
      sessionId: "room-integrity",
      recordedAt: 100,
      entries: [
        { playerId: "alpha", score: 55, survivalMs: 12_000 },
        { playerId: "beta", score: 44, survivalMs: 11_000 },
      ],
    });

    const mismatchedDuplicate = leaderboard.recordMatchResult({
      eventId: "match-final:room-integrity",
      sessionId: "room-integrity",
      recordedAt: 120,
      entries: [
        { playerId: "alpha", score: 70, survivalMs: 14_000 },
        { playerId: "beta", score: 44, survivalMs: 11_000 },
      ],
    });

    expect(mismatchedDuplicate.idempotent).toBe(true);
    expect(mismatchedDuplicate.commits).toEqual([]);
    expect(leaderboard.getStandings()).toMatchObject([
      { playerId: "alpha", score: 55, survivalMs: 12_000 },
      { playerId: "beta", score: 44, survivalMs: 11_000 },
    ]);

    const quarantineEvents = sink.list({ type: "leaderboard.integrity.mismatch_quarantined" });
    expect(quarantineEvents).toHaveLength(1);
    expect(quarantineEvents[0]?.payload).toMatchObject({
      eventId: "match-final:room-integrity",
      sessionId: "room-integrity",
      quarantined: true,
      reason: "event_payload_mismatch",
      mismatchKinds: ["entries"],
    });

    const writeEvents = sink.list({ type: "leaderboard.write" });
    expect(writeEvents).toHaveLength(2);
    expect(writeEvents[1]?.payload).toMatchObject({
      eventId: "match-final:room-integrity",
      idempotent: true,
      quarantined: true,
      integrityReason: "event_payload_mismatch",
    });
  });

  it("accepts duplicate event ids when canonical payload matches despite entry order changes", () => {
    const sink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink: sink });

    leaderboard.recordMatchResult({
      eventId: "match-final:room-order",
      sessionId: "room-order",
      recordedAt: 100,
      entries: [
        { playerId: "beta", score: 80, survivalMs: 12_500 },
        { playerId: "alpha", score: 90, survivalMs: 13_500 },
      ],
    });

    const duplicate = leaderboard.recordMatchResult({
      eventId: "match-final:room-order",
      sessionId: "room-order",
      recordedAt: 140,
      entries: [
        { playerId: "alpha", score: 90, survivalMs: 13_500 },
        { playerId: "beta", score: 80, survivalMs: 12_500 },
      ],
    });

    expect(duplicate.idempotent).toBe(true);
    expect(sink.list({ type: "leaderboard.integrity.mismatch_quarantined" })).toHaveLength(0);
  });
});
