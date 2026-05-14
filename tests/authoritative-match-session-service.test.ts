import { describe, expect, it } from "vitest";

import {
  AuthoritativeMatchSessionService,
  replayAuthoritativeMatchSessionLog,
  type MatchEventLogEntry,
} from "../src/core/authoritative-match-session-service";
import { SessionManager, type RoomFlowState } from "../src/core/session-manager";
import { type SessionIntegrityConfig } from "../src/core/session-integrity";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

function createService(tickMs = 50): {
  service: AuthoritativeMatchSessionService;
  events: InMemoryEventSink;
};
function createService(
  tickMs = 50,
  integrityConfig?: Partial<SessionIntegrityConfig>,
): {
  service: AuthoritativeMatchSessionService;
  events: InMemoryEventSink;
} {
  const events = new InMemoryEventSink();
  const leaderboard = new LeaderboardService({ eventSink: events });
  const sessions = new SessionManager({ eventSink: events, leaderboard, integrityConfig });

  return {
    service: new AuthoritativeMatchSessionService({ sessions, tickMs, integrityConfig }),
    events,
  };
}

function tickEvents(log: ReadonlyArray<MatchEventLogEntry>): MatchEventLogEntry[] {
  return log.filter((entry) => entry.type === "tick.advanced");
}

describe("AuthoritativeMatchSessionService", () => {
  it("runs fixed 20Hz simulation ticks and fans out snapshots", () => {
    const { service } = createService(50);

    service.createMatch({
      matchId: "match-20hz",
      nowMs: 0,
      players: [
        { playerId: "alpha", spawnHeight: 6 },
        { playerId: "beta", spawnHeight: 6 },
      ],
    });

    const snapshots: RoomFlowState[] = [];
    service.subscribeSnapshots("match-20hz", (snapshot) => {
      snapshots.push(snapshot);
    });

    service.submitIntent(
      "match-20hz",
      { playerId: "alpha", sequence: 1, thrust: 0.25 },
      10,
    );
    service.submitIntent(
      "match-20hz",
      { playerId: "beta", sequence: 1, thrust: 0.1 },
      12,
    );

    expect(service.flush("match-20hz", 49)).toBe(0);
    expect(service.flush("match-20hz", 150)).toBe(3);

    expect(snapshots).toHaveLength(3);
    expect(snapshots.map((snapshot) => snapshot.world.tick)).toEqual([1, 2, 3]);

    const log = service.getEventLog("match-20hz");
    expect(tickEvents(log).map((entry) => entry.occurredAtMs)).toEqual([50, 100, 150]);
    expect(service.getMatchState("match-20hz").tickRateHz).toBe(20);
  });

  it("records deterministic ordering key (matchId, tick, seqInTick)", () => {
    const { service } = createService(50);

    service.createMatch({
      matchId: "match-ordering",
      nowMs: 0,
      players: [
        { playerId: "alpha", spawnHeight: 6 },
        { playerId: "beta", spawnHeight: 6 },
      ],
    });

    service.submitIntent(
      "match-ordering",
      { playerId: "beta", sequence: 1, thrust: 0.2 },
      10,
    );
    service.submitIntent(
      "match-ordering",
      { playerId: "alpha", sequence: 1, thrust: 0.2 },
      10,
    );
    service.submitIntent(
      "match-ordering",
      { playerId: "alpha", sequence: 2, thrust: 0.3 },
      11,
    );

    service.flush("match-ordering", 50);

    const tickOneEntries = service
      .getEventLog("match-ordering")
      .filter((entry) => entry.orderingKey.tick === 1 && entry.type !== "snapshot.fanout");

    expect(tickOneEntries.map((entry) => entry.orderingKey.seqInTick)).toEqual([1, 2, 3, 4]);
    expect(tickOneEntries.map((entry) => entry.orderingKey.matchId)).toEqual([
      "match-ordering",
      "match-ordering",
      "match-ordering",
      "match-ordering",
    ]);

    expect(
      tickOneEntries
        .filter((entry) => entry.type === "intent.applied")
        .map((entry) => entry.payload.playerId),
    ).toEqual(["alpha", "beta", "alpha"]);
  });

  it("replays event log deterministically for seeded intent tape", () => {
    const { service } = createService(50);

    service.createMatch({
      matchId: "match-replay",
      nowMs: 0,
      players: [
        { playerId: "alpha", spawnHeight: 7 },
        { playerId: "beta", spawnHeight: 7 },
      ],
    });

    service.submitIntent(
      "match-replay",
      { playerId: "alpha", sequence: 1, thrust: 0.4 },
      5,
    );
    service.submitIntent(
      "match-replay",
      { playerId: "beta", sequence: 1, thrust: 0.2 },
      12,
    );
    service.submitIntent(
      "match-replay",
      { playerId: "alpha", sequence: 2, thrust: 0 },
      53,
    );

    service.flush("match-replay", 200);

    const finalState = service.getFlowState("match-replay");
    const log = service.getEventLog("match-replay");
    const verification = replayAuthoritativeMatchSessionLog(log);

    expect(verification.ok).toBe(true);
    expect(verification.mismatches).toEqual([]);
    expect(verification.finalTick).toBe(finalState.world.tick);
    expect(verification.finalStateHash).toBe(finalState.world.stateHash);
  });

  it("rejects client-state authority fields and only accepts pure intents", () => {
    const { service } = createService(50);

    service.createMatch({
      matchId: "match-intent-only",
      nowMs: 0,
      players: [{ playerId: "alpha", spawnHeight: 6 }],
    });

    const invalid = service.submitIntent(
      "match-intent-only",
      {
        playerId: "alpha",
        sequence: 1,
        thrust: 0.2,
        clientStateHash: "spoofed",
      } as unknown as {
        playerId: string;
        sequence: number;
        thrust: number;
      },
      10,
    );

    expect(invalid).toEqual({ accepted: false, reason: "client_state_not_allowed" });

    service.flush("match-intent-only", 50);
    const state = service.getFlowState("match-intent-only");
    const alpha = state.players.find((player) => player.playerId === "alpha");

    expect(alpha?.lastInputSequence).toBe(0);
  });

  it("drops stale intents by age guard and emits integrity telemetry", () => {
    const { service, events } = createService(50, {
      enforceIntentAge: true,
      maxIntentAgeMs: 20,
    });

    service.createMatch({
      matchId: "match-intent-age",
      nowMs: 0,
      players: [{ playerId: "alpha", spawnHeight: 6 }],
    });

    service.submitIntent(
      "match-intent-age",
      { playerId: "alpha", sequence: 1, thrust: 0.4 },
      0,
    );
    service.flush("match-intent-age", 50);

    const rejected = service
      .getEventLog("match-intent-age")
      .find((entry) => entry.type === "intent.rejected" && entry.payload.sequence === 1);
    expect(rejected?.payload.reason).toBe("stale_time_drift");

    const violations = events.list({ type: "session.integrity.violation", limit: 1_000 });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.payload).toMatchObject({
      ruleId: "TIM-003",
      category: "time_drift",
      action: "reject_input",
    });
  });
});
