import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

describe("multiplayer flow-state contract", () => {
  it("moves room state from lobby to in_round to results with revisioned snapshots", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-flow", nowMs: 100 });

    const created = sessions.getFlowState("room-flow");
    expect(created.phase).toBe("lobby");
    expect(created.revision).toBe(1);
    expect(created.players).toHaveLength(0);

    sessions.joinRoom("room-flow", "alpha", { nowMs: 110, spawnHeight: 6 });
    sessions.joinRoom("room-flow", "beta", { nowMs: 120, spawnHeight: 5.8 });

    const lobby = sessions.getFlowState("room-flow");
    expect(lobby.phase).toBe("lobby");
    expect(lobby.revision).toBe(3);
    expect(lobby.players.map((player) => player.playerId)).toEqual(["alpha", "beta"]);

    sessions.submitInput("room-flow", "alpha", { sequence: 1, thrust: 0.2 });
    sessions.submitInput("room-flow", "beta", { sequence: 1, thrust: 0.1 });

    sessions.advanceRoom("room-flow", 500);

    const inRound = sessions.getFlowState("room-flow");
    expect(inRound.phase).toBe("in_round");
    expect(inRound.revision).toBe(4);
    expect(inRound.world.tick).toBe(1);

    const ingestion = sessions.completeRoom("room-flow", { recordedAt: 2_000 });

    const results = sessions.getFlowState("room-flow");
    expect(results.phase).toBe("results");
    expect(results.revision).toBe(5);
    expect(results.completedAt).toBe(2_000);
    expect(results.standings).toEqual(ingestion.standings);
    expect(results.commits).toEqual(ingestion.commits);

    expect(() => sessions.advanceRoom("room-flow", 100)).toThrow(/already completed/i);
  });

  it("emits telemetry for flow-state transitions", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-events", nowMs: 0 });
    sessions.joinRoom("room-events", "alpha", { nowMs: 5 });
    sessions.advanceRoom("room-events", 100);
    sessions.completeRoom("room-events", { recordedAt: 200 });

    const transitions = eventSink.list({ type: "session.flow_state.updated" });
    const phases = transitions.map((event) =>
      (event.payload as { phase: string; revision: number }).phase,
    );
    const revisions = transitions.map((event) =>
      (event.payload as { phase: string; revision: number }).revision,
    );

    expect(phases).toEqual(["lobby", "lobby", "in_round", "results"]);
    expect(revisions).toEqual([1, 2, 3, 4]);
  });

  it("expires reconnect grace in-session and marks the player disconnected", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-reconnect", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-reconnect", "alpha", { nowMs: 10, spawnHeight: 12 });
    sessions.advanceRoom("room-reconnect", 100, 100);

    const disconnect = sessions.disconnectPlayer("room-reconnect", "alpha", { nowMs: 200 });
    sessions.advanceRoom("room-reconnect", 100, 1_250);

    const reconnect = sessions.reconnectPlayer("room-reconnect", disconnect.resumeToken, {
      nowMs: 1_260,
    });
    expect(reconnect).toMatchObject({
      connected: false,
      reason: "token_expired",
      playerId: "alpha",
    });

    const state = sessions.getFlowState("room-reconnect");
    const alpha = state.players.find((player) => player.playerId === "alpha");
    expect(alpha).toMatchObject({
      connected: false,
      isEliminated: true,
      eliminationReason: "disconnected",
    });

    const expiryEvents = eventSink.list({ type: "session.lifecycle.reconnect_expired" });
    expect(expiryEvents).toHaveLength(1);
    expect(expiryEvents[0]?.payload).toMatchObject({
      sessionId: "room-reconnect",
      playerId: "alpha",
    });
  });

  it("emits dedicated telemetry when input abuse limits reject submissions", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({
      sessionId: "room-rate-telemetry",
      nowMs: 0,
      playerInputRateLimitPerSecond: 1,
      roomInputRateLimitPerSecond: 5,
      inputRateWindowMs: 1_000,
    });
    sessions.joinRoom("room-rate-telemetry", "alpha", { nowMs: 10, spawnHeight: 10 });

    sessions.submitInput("room-rate-telemetry", "alpha", { sequence: 1, thrust: 0.2 }, 100);
    sessions.submitInput("room-rate-telemetry", "alpha", { sequence: 2, thrust: 0.3 }, 110);

    const abuseEvents = eventSink.list({ type: "session.input.rate_limited" });
    expect(abuseEvents).toHaveLength(1);
    expect(abuseEvents[0]?.payload).toMatchObject({
      sessionId: "room-rate-telemetry",
      playerId: "alpha",
      scope: "player",
      sequence: 2,
    });
  });

  it("escalates repeated rejected inputs from warn to critical within configured window", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({
      eventSink,
      leaderboard,
      integrityConfig: {
        rejectEscalationWindowMs: 1_000,
        rejectEscalationElevatedCount: 1,
        rejectEscalationThrottleCount: 2,
        rejectEscalationCriticalCount: 3,
      },
    });

    sessions.createRoom({
      sessionId: "room-integrity-input-escalation",
      nowMs: 0,
      playerInputRateLimitPerSecond: 100,
      roomInputRateLimitPerSecond: 100,
      inputRateWindowMs: 1_000,
    });
    sessions.joinRoom("room-integrity-input-escalation", "alpha", { nowMs: 5, spawnHeight: 8 });

    sessions.submitInput("room-integrity-input-escalation", "alpha", { sequence: 1, thrust: 0.2 }, 10);
    sessions.submitInput("room-integrity-input-escalation", "alpha", { sequence: 1, thrust: 0.2 }, 20);
    sessions.submitInput("room-integrity-input-escalation", "alpha", { sequence: 1, thrust: 0.2 }, 30);
    sessions.submitInput("room-integrity-input-escalation", "alpha", { sequence: 1, thrust: 0.2 }, 40);

    const escalationEvents = eventSink.list({ type: "session.integrity.escalated", limit: 1_000 });
    expect(escalationEvents).toHaveLength(2);
    expect(escalationEvents.map((event) => (event.payload as { toSeverity: string }).toSeverity)).toEqual([
      "elevated",
      "critical",
    ]);

    const violations = eventSink.list({ type: "session.integrity.violation", limit: 1_000 });
    expect(violations.some((event) => (event.payload as { ruleId: string }).ruleId === "INP-003")).toBe(true);
  });

  it("escalates repeated desync detections for the same player", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({
      eventSink,
      leaderboard,
      integrityConfig: {
        desyncEscalationWindowMs: 1_000,
        desyncEscalationCount: 2,
      },
    });

    sessions.createRoom({ sessionId: "room-desync-escalation", nowMs: 0 });
    sessions.joinRoom("room-desync-escalation", "alpha", { nowMs: 5, spawnHeight: 8 });

    sessions.recordSyncDesync({
      sessionId: "room-desync-escalation",
      playerId: "alpha",
      action: "input",
      reason: "state_hash_mismatch",
      receivedRevision: 1,
      authoritativeRevision: 1,
      receivedTick: 0,
      authoritativeTick: 0,
      receivedStateHash: "bad0",
      authoritativeStateHash: "good0",
      tickDelta: 0,
      maxAllowedTickDelta: 2,
      detectedAt: 100,
    });
    sessions.recordSyncDesync({
      sessionId: "room-desync-escalation",
      playerId: "alpha",
      action: "input",
      reason: "state_hash_mismatch",
      receivedRevision: 1,
      authoritativeRevision: 1,
      receivedTick: 0,
      authoritativeTick: 0,
      receivedStateHash: "bad1",
      authoritativeStateHash: "good1",
      tickDelta: 0,
      maxAllowedTickDelta: 2,
      detectedAt: 200,
    });

    const escalationEvents = eventSink.list({ type: "session.integrity.escalated", limit: 1_000 });
    expect(escalationEvents).toHaveLength(1);
    expect(escalationEvents[0]?.payload).toMatchObject({
      triggerRuleId: "TIM-002",
      toSeverity: "elevated",
    });
  });

  it("emits tick-lag SLO telemetry with p95/p99 percentiles", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-tick-slo", nowMs: 0 });
    sessions.joinRoom("room-tick-slo", "alpha", { nowMs: 1, spawnHeight: 8 });

    sessions.advanceRoom("room-tick-slo", 100, 100);
    sessions.advanceRoom("room-tick-slo", 100, 210);
    sessions.advanceRoom("room-tick-slo", 100, 330);
    sessions.advanceRoom("room-tick-slo", 100, 460);

    const lagEvents = eventSink.list({ type: "session.slo.tick_lag" });
    expect(lagEvents).toHaveLength(4);
    expect(lagEvents[3]?.payload).toMatchObject({
      sessionId: "room-tick-slo",
      tick: 4,
      targetDeltaMs: 100,
      lagMs: 30,
      p95LagMs: 30,
      p99LagMs: 30,
      sampleSize: 4,
    });
  });

  it("emits tick-lag integrity violation and escalates after sustained breach", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({
      eventSink,
      leaderboard,
      integrityConfig: {
        tickLagWarnP95Ticks: 0.01,
        tickLagWarnWindowMs: 50,
        tickLagCriticalP95Ticks: 0.01,
        tickLagCriticalWindowMs: 50,
        tickLagPageTicks: 999,
      },
    });

    sessions.createRoom({ sessionId: "room-tick-integrity", nowMs: 0 });
    sessions.joinRoom("room-tick-integrity", "alpha", { nowMs: 1, spawnHeight: 8 });
    sessions.advanceRoom("room-tick-integrity", 100, 100);
    sessions.advanceRoom("room-tick-integrity", 100, 220);
    sessions.advanceRoom("room-tick-integrity", 100, 340);

    const violations = eventSink.list({ type: "session.integrity.violation", limit: 1_000 });
    expect(violations.some((event) => (event.payload as { ruleId: string }).ruleId === "TIM-001")).toBe(true);

    const escalationEvents = eventSink.list({ type: "session.integrity.escalated", limit: 1_000 });
    expect(escalationEvents).toHaveLength(1);
    expect(escalationEvents[0]?.payload).toMatchObject({
      triggerRuleId: "TIM-001",
      toSeverity: "critical",
    });
  });

  it("emits reconnect success-rate telemetry with reason breakdown", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-reconnect-slo", nowMs: 0, reconnectGraceMs: 30_000 });
    sessions.joinRoom("room-reconnect-slo", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.advanceRoom("room-reconnect-slo", 100, 100);

    const firstDisconnect = sessions.disconnectPlayer("room-reconnect-slo", "alpha", { nowMs: 200 });
    expect(
      sessions.reconnectPlayer("room-reconnect-slo", firstDisconnect.resumeToken, { nowMs: 210 }),
    ).toMatchObject({
      connected: true,
      playerId: "alpha",
    });
    expect(
      sessions.reconnectPlayer("room-reconnect-slo", firstDisconnect.resumeToken, { nowMs: 220 }),
    ).toMatchObject({
      connected: false,
      reason: "token_replayed",
      playerId: "alpha",
    });
    expect(
      sessions.reconnectPlayer("room-reconnect-slo", "pc1.invalid.token", { nowMs: 230 }),
    ).toMatchObject({
      connected: false,
      reason: "unknown_token",
    });

    const secondDisconnect = sessions.disconnectPlayer("room-reconnect-slo", "alpha", { nowMs: 300 });
    expect(
      sessions.reconnectPlayer("room-reconnect-slo", secondDisconnect.resumeToken, { nowMs: 30_400 }),
    ).toMatchObject({
      connected: false,
      reason: "token_expired",
      playerId: "alpha",
    });

    const reconnectSloEvents = eventSink.list({ type: "session.slo.reconnect_success_rate" });
    expect(reconnectSloEvents).toHaveLength(4);
    expect(reconnectSloEvents[3]?.payload).toMatchObject({
      sessionId: "room-reconnect-slo",
      reconnectWindowMs: 30_000,
      attempts: 4,
      successes: 1,
      failures: 3,
      successRate: 0.25,
      reasonBreakdown: {
        connected: 1,
        unknown_token: 1,
        token_expired: 1,
        token_replayed: 1,
      },
    });
  });

  it("keeps scoring authoritative when tampered input sequences are rejected", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    const playRoom = (sessionId: string, injectTamperedInputs: boolean): number => {
      sessions.createRoom({
        sessionId,
        nowMs: 0,
        playerInputRateLimitPerSecond: 2,
        roomInputRateLimitPerSecond: 4,
        inputRateWindowMs: 1_000,
      });
      sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 8 });
      sessions.joinRoom(sessionId, "beta", { nowMs: 20, spawnHeight: 8 });

      sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 0.2 }, 100);
      sessions.submitInput(sessionId, "beta", { sequence: 1, thrust: 0.2 }, 120);

      if (injectTamperedInputs) {
        sessions.submitInput(sessionId, "alpha", { sequence: 50, thrust: 1 }, 140);
        sessions.submitInput(sessionId, "alpha", { sequence: 2, thrust: 1 }, 160);
        sessions.submitInput(sessionId, "alpha", { sequence: 3, thrust: 1 }, 170);
      }

      sessions.advanceRoom(sessionId, 500, 600);
      const result = sessions.completeRoom(sessionId, { recordedAt: 700 });
      const alphaCommit = result.commits.find((commit) => commit.playerId === "alpha");
      expect(alphaCommit).toBeDefined();

      return alphaCommit?.score ?? -1;
    };

    const cleanScore = playRoom("room-clean-score", false);
    const tamperedScore = playRoom("room-tampered-score", true);
    const rejected = eventSink
      .list({ type: "session.input.rejected" })
      .filter((event) => (event.payload as { sessionId: string }).sessionId === "room-tampered-score");

    expect(rejected.some((event) => (event.payload as { result: { reason: string } }).result.reason === "out_of_order"))
      .toBe(true);
    expect(rejected.some((event) =>
      (event.payload as { result: { reason: string } }).result.reason === "rate_limited_player")).toBe(true);
    expect(tamperedScore).toBe(cleanScore);
  });

  it("publishes countdown, reconnecting, and eliminated UX state markers", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-ux-states", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-ux-states", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-ux-states", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.setPlayerReady("room-ux-states", "alpha", true, 30);
    sessions.setPlayerReady("room-ux-states", "beta", true, 40);

    const countdown = sessions.getFlowState("room-ux-states");
    expect((countdown as { uxState?: { id?: string; reason?: string } }).uxState).toMatchObject({
      id: "PM-COUNTDOWN",
      reason: "ready_threshold_met",
    });

    sessions.advanceRoom("room-ux-states", 100, 100);
    const active = sessions.getFlowState("room-ux-states");
    expect((active as { uxState?: { id?: string } }).uxState?.id).toBe("HUD-ACTIVE");

    const disconnect = sessions.disconnectPlayer("room-ux-states", "alpha", { nowMs: 200 });
    const reconnecting = sessions.getFlowState("room-ux-states");
    expect((reconnecting as { uxState?: { id?: string; reason?: string } }).uxState).toMatchObject({
      id: "HUD-RECONNECTING",
      reason: "player_disconnected",
      reconnectTimeout: {
        budgetMs: 1_000,
        remainingMs: 1_000,
        expiresAtMs: 1_200,
      },
    });

    sessions.advanceRoom("room-ux-states", 100, 700);
    const reconnectingMidWindow = sessions.getFlowState("room-ux-states");
    expect((reconnectingMidWindow as { uxState?: { reconnectTimeout?: Record<string, number> } }).uxState).toMatchObject(
      {
        reconnectTimeout: {
          budgetMs: 1_000,
          remainingMs: 500,
          expiresAtMs: 1_200,
        },
      },
    );

    sessions.advanceRoom("room-ux-states", 100, 1_250);
    expect(
      sessions.reconnectPlayer("room-ux-states", disconnect.resumeToken, {
        nowMs: 1_260,
      }),
    ).toMatchObject({
      connected: false,
      reason: "token_expired",
      playerId: "alpha",
    });

    const eliminated = sessions.getFlowState("room-ux-states");
    expect((eliminated as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "HUD-ELIMINATED",
      eliminationCause: "disconnected",
      reconnectTimeout: {
        budgetMs: 1_000,
        remainingMs: 0,
        expiresAtMs: 1_200,
        terminalReason: "token_expired",
      },
    });
  });

  it("holds lobby state until ready threshold is met and only then enters countdown", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-ready-gate", nowMs: 0 });
    sessions.joinRoom("room-ready-gate", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-ready-gate", "beta", { nowMs: 20, spawnHeight: 8 });

    const beforeReady = sessions.getFlowState("room-ready-gate");
    expect((beforeReady as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-LOBBY-STATUS",
      readiness: {
        minReadyThreshold: 2,
        readyCount: 0,
        thresholdSatisfied: false,
        players: [
          { playerId: "alpha", ready: false, connected: true },
          { playerId: "beta", ready: false, connected: true },
        ],
      },
    });

    sessions.setPlayerReady("room-ready-gate", "alpha", true, 30);
    const partiallyReady = sessions.getFlowState("room-ready-gate");
    expect((partiallyReady as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-LOBBY-STATUS",
      readiness: {
        minReadyThreshold: 2,
        readyCount: 1,
        thresholdSatisfied: false,
      },
    });

    sessions.setPlayerReady("room-ready-gate", "beta", true, 40);
    const countdown = sessions.getFlowState("room-ready-gate");
    expect((countdown as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-COUNTDOWN",
      reason: "ready_threshold_met",
      countdownSeconds: 3,
      readiness: {
        minReadyThreshold: 2,
        readyCount: 2,
        thresholdSatisfied: true,
      },
    });
  });

  it("emits deterministic countdown interruption payloads for paused, resumed, and cancelled", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-countdown-interrupt", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-countdown-interrupt", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-countdown-interrupt", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.setPlayerReady("room-countdown-interrupt", "alpha", true, 30);
    sessions.setPlayerReady("room-countdown-interrupt", "beta", true, 40);

    const alphaDisconnect = sessions.disconnectPlayer("room-countdown-interrupt", "alpha", { nowMs: 50 });
    const paused = sessions.getFlowState("room-countdown-interrupt");
    expect((paused as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-COUNTDOWN",
      reason: "paused",
      countdownInterruption: {
        state: "paused",
        reason: "player_disconnected",
        pauseCapMs: 5_000,
        pauseRemainingMs: 5_000,
      },
    });

    sessions.reconnectPlayer("room-countdown-interrupt", alphaDisconnect.resumeToken, {
      nowMs: 150,
    });
    const resumed = sessions.getFlowState("room-countdown-interrupt");
    expect((resumed as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-COUNTDOWN",
      reason: "resumed",
      countdownInterruption: {
        state: "resumed",
        reason: "player_reconnected",
      },
    });

    sessions.disconnectPlayer("room-countdown-interrupt", "alpha", { nowMs: 200 });
    sessions.setPlayerReady("room-countdown-interrupt", "beta", true, 5_205);
    const cancelled = sessions.getFlowState("room-countdown-interrupt");
    expect((cancelled as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-LOBBY-STATUS",
      reason: "cancelled",
      countdownInterruption: {
        state: "cancelled",
        reason: "min_ready_not_met",
      },
      readiness: {
        minReadyThreshold: 2,
        readyCount: 1,
        thresholdSatisfied: false,
      },
    });
  });

  it("exposes TS-CONNECT-FAILED with locked fallback payload and transport-connected recovery trigger", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-connect-failed", nowMs: 0 });
    sessions.markTransportConnectFailed("room-connect-failed", 50);

    const failed = sessions.getFlowState("room-connect-failed");
    expect((failed as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "TS-CONNECT-FAILED",
      reason: "transport_connect_failed",
      queueTimeoutFallback: {
        title: "Couldn’t find a match yet",
        body: "Still searching for an open lobby. Retry now or create a room.",
        primaryCta: "Retry",
        secondaryCta: "Create Room",
      },
    });

    sessions.joinRoom("room-connect-failed", "alpha", { nowMs: 70, spawnHeight: 8 });

    const recovered = sessions.getFlowState("room-connect-failed");
    expect((recovered as { uxState?: { id?: string; reason?: string } }).uxState).toMatchObject({
      id: "PM-LOBBY-STATUS",
      reason: "transport_connected",
    });
  });

  it("delivers first-session onboarding cues once per player across queue fallback, countdown, and hazard urgency", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-first-session-onboarding", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-first-session-onboarding", "alpha", { nowMs: 10, spawnHeight: 2 });
    sessions.joinRoom("room-first-session-onboarding", "beta", { nowMs: 20, spawnHeight: 2.1 });
    sessions.markTransportConnectFailed("room-first-session-onboarding", 30);

    const connectFailed = sessions.getFlowState("room-first-session-onboarding");
    expect((connectFailed as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "TS-CONNECT-FAILED",
      onboarding: {
        cueOrder: ["OB-QUEUE-FALLBACK", "OB-COUNTDOWN-READY", "OB-HAZARD-URGENCY"],
        byPlayerId: {
          alpha: {
            id: "OB-QUEUE-FALLBACK",
            dismissible: true,
            nonBlocking: true,
          },
          beta: {
            id: "OB-QUEUE-FALLBACK",
            dismissible: true,
            nonBlocking: true,
          },
        },
      },
    });

    expect(
      sessions.acknowledgeOnboardingCue(
        "room-first-session-onboarding",
        "alpha",
        "OB-QUEUE-FALLBACK",
        40,
      ),
    ).toMatchObject({
      acknowledged: true,
      alreadyAcknowledged: false,
      playerId: "alpha",
      cueId: "OB-QUEUE-FALLBACK",
    });

    const queueCueAcked = sessions.getFlowState("room-first-session-onboarding");
    expect((queueCueAcked as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      onboarding: {
        byPlayerId: {
          alpha: null,
          beta: {
            id: "OB-QUEUE-FALLBACK",
          },
        },
      },
    });

    sessions.setPlayerReady("room-first-session-onboarding", "alpha", true, 50);
    sessions.setPlayerReady("room-first-session-onboarding", "beta", true, 60);

    const countdown = sessions.getFlowState("room-first-session-onboarding");
    expect((countdown as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "PM-COUNTDOWN",
      onboarding: {
        byPlayerId: {
          alpha: {
            id: "OB-COUNTDOWN-READY",
          },
          beta: {
            id: "OB-COUNTDOWN-READY",
          },
        },
      },
    });

    sessions.acknowledgeOnboardingCue("room-first-session-onboarding", "alpha", "OB-COUNTDOWN-READY", 70);
    sessions.acknowledgeOnboardingCue("room-first-session-onboarding", "beta", "OB-COUNTDOWN-READY", 80);

    sessions.submitInput("room-first-session-onboarding", "alpha", { sequence: 1, thrust: 1 }, 90);
    sessions.submitInput("room-first-session-onboarding", "beta", { sequence: 1, thrust: 1 }, 100);
    sessions.advanceRoom("room-first-session-onboarding", 2_000, 2_100);

    const hazardUrgency = sessions.getFlowState("room-first-session-onboarding");
    expect((hazardUrgency as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "HUD-ACTIVE",
      onboarding: {
        byPlayerId: {
          alpha: {
            id: "OB-HAZARD-URGENCY",
          },
          beta: {
            id: "OB-HAZARD-URGENCY",
          },
        },
      },
    });

    sessions.disconnectPlayer("room-first-session-onboarding", "alpha", { nowMs: 2_200 });
    sessions.advanceRoom("room-first-session-onboarding", 100, 3_400);
    const eliminated = sessions.getFlowState("room-first-session-onboarding");
    expect((eliminated as { uxState?: Record<string, unknown> }).uxState).toMatchObject({
      id: "HUD-ELIMINATED",
      onboarding: {
        byPlayerId: {
          alpha: null,
          beta: null,
        },
      },
    });

    expect(
      sessions.acknowledgeOnboardingCue(
        "room-first-session-onboarding",
        "alpha",
        "OB-QUEUE-FALLBACK",
        3_300,
      ),
    ).toMatchObject({
      acknowledged: true,
      alreadyAcknowledged: true,
      playerId: "alpha",
      cueId: "OB-QUEUE-FALLBACK",
    });
  });

  it("includes required HUD view-model fields with locked labels, cadence, and formats", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-hud-contract", nowMs: 0 });
    sessions.joinRoom("room-hud-contract", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.joinRoom("room-hud-contract", "beta", { nowMs: 20, spawnHeight: 8.5 });
    sessions.submitInput("room-hud-contract", "alpha", { sequence: 1, thrust: 0.2 }, 40);
    sessions.submitInput("room-hud-contract", "beta", { sequence: 1, thrust: 0.1 }, 45);
    sessions.advanceRoom("room-hud-contract", 1_000, 1_100);

    const inRound = sessions.getFlowState("room-hud-contract");
    const hud = (inRound as { hud?: { cadence?: Record<string, string>; byPlayerId?: Record<string, unknown> } }).hud;
    expect(hud).toBeDefined();
    expect(hud?.cadence).toEqual({
      rank: "4Hz",
      score: "4Hz",
      survivalTime: "1Hz",
      groundSpeed: "event",
      playersLeft: "4Hz",
    });

    const alphaHud = hud?.byPlayerId?.alpha as
      | {
          rank?: { label?: string; value?: string };
          score?: { label?: string; value?: number };
          survivalTime?: { label?: string; value?: string };
          groundSpeed?: { label?: string; value?: string };
          playersLeft?: { label?: string; value?: string };
        }
      | undefined;
    expect(alphaHud).toBeDefined();
    expect(alphaHud?.rank).toMatchObject({ label: "Rank" });
    expect(alphaHud?.score).toMatchObject({ label: "Score" });
    expect(alphaHud?.survivalTime).toMatchObject({ label: "Survival Time" });
    expect(alphaHud?.groundSpeed).toMatchObject({ label: "Ground Speed" });
    expect(alphaHud?.playersLeft).toMatchObject({ label: "Players Left" });
    expect(alphaHud?.rank?.value).toMatch(/^#\d+\/\d+$/);
    expect(alphaHud?.score?.value).toEqual(expect.any(Number));
    expect(alphaHud?.survivalTime?.value).toMatch(/^\d{2}:\d{2}$/);
    expect(alphaHud?.groundSpeed?.value).toMatch(/^x\d+(\.\d+)?$/);
    expect(alphaHud?.playersLeft?.value).toMatch(/^\d+\/\d+$/);
  });

  it("exposes realtime leaderboard snapshot/delta contract and reconciles disconnect/rejoin identity", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-live-leaderboard", nowMs: 0, reconnectGraceMs: 3_000 });
    sessions.joinRoom("room-live-leaderboard", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-live-leaderboard", "beta", { nowMs: 20, spawnHeight: 8 });

    const lobby = sessions.getFlowState("room-live-leaderboard");
    const lobbyLeaderboard = (lobby as { leaderboard?: { snapshot: Array<Record<string, unknown>> } }).leaderboard;
    expect(lobbyLeaderboard?.snapshot.map((entry) => entry.playerId)).toEqual(["alpha", "beta"]);
    expect(lobbyLeaderboard?.snapshot).toMatchObject([
      { playerId: "alpha", rank: 1, isTie: true, placementToken: "T-1" },
      { playerId: "beta", rank: 1, isTie: true, placementToken: "T-1" },
    ]);

    sessions.submitInput("room-live-leaderboard", "alpha", { sequence: 1, thrust: 0.7 }, 30);
    sessions.submitInput("room-live-leaderboard", "beta", { sequence: 1, thrust: 0.1 }, 40);
    sessions.advanceRoom("room-live-leaderboard", 1_000, 1_100);

    const inRound = sessions.getFlowState("room-live-leaderboard");
    const inRoundLeaderboard = (inRound as {
      leaderboard?: { snapshot: Array<{ playerId: string }>; updates: Array<Record<string, unknown>> };
    }).leaderboard;
    expect(inRoundLeaderboard?.snapshot).toHaveLength(2);
    expect(inRoundLeaderboard?.updates.length).toBeGreaterThan(0);

    const leaderboardEvents = eventSink.list({ type: "session.leaderboard.updated" });
    expect(leaderboardEvents.length).toBeGreaterThan(0);
    const latestPayload = leaderboardEvents.at(-1)?.payload as {
      snapshot: Array<{ playerId: string }>;
      updates: Array<Record<string, unknown>>;
    };
    expect(latestPayload.snapshot).toEqual(inRoundLeaderboard?.snapshot);
    expect(latestPayload.updates).toEqual(inRoundLeaderboard?.updates);

    const disconnect = sessions.disconnectPlayer("room-live-leaderboard", "alpha", { nowMs: 1_200 });
    expect(
      sessions.reconnectPlayer("room-live-leaderboard", disconnect.resumeToken, {
        nowMs: 1_250,
      }),
    ).toMatchObject({
      connected: true,
      playerId: "alpha",
    });

    const postReconnect = sessions.getFlowState("room-live-leaderboard");
    const postReconnectLeaderboard = (postReconnect as { leaderboard?: { snapshot: Array<{ playerId: string }> } }).leaderboard;
    const playerIds = postReconnectLeaderboard?.snapshot.map((entry) => entry.playerId) ?? [];
    expect(playerIds).toEqual(["alpha", "beta"]);
    expect(new Set(playerIds).size).toBe(2);

    const complete = sessions.completeRoom("room-live-leaderboard", { recordedAt: 2_000 });
    expect(new Set(complete.commits.map((entry) => entry.playerId))).toEqual(new Set(["alpha", "beta"]));
    expect(new Set(complete.standings.map((entry) => entry.playerId))).toEqual(new Set(["alpha", "beta"]));
  });

  it("models pending/retrying/failed results commit lifecycle with retry metadata and ack gating", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-results-pending", nowMs: 0 });
    sessions.joinRoom("room-results-pending", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-pending", 100, 150);
    sessions.completeRoom("room-results-pending", {
      recordedAt: 900,
      commitLatencyMs: 600,
    } as { recordedAt: number });
    const pending = sessions.getFlowState("room-results-pending");
    expect((pending as { resultsLifecycle?: { state?: string; copyKey?: string } }).resultsLifecycle).toMatchObject({
      state: "RESULTS-PENDING",
      copyKey: "results.pending.saving",
    });

    sessions.createRoom({ sessionId: "room-results-retrying", nowMs: 0 });
    sessions.joinRoom("room-results-retrying", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-retrying", 100, 150);
    sessions.completeRoom("room-results-retrying", {
      recordedAt: 900,
      commitLatencyMs: 6_200,
      retryAttempt: 2,
      retryMaxAttempts: 4,
    } as { recordedAt: number });
    const retrying = sessions.getFlowState("room-results-retrying");
    expect((retrying as { resultsLifecycle?: Record<string, unknown> }).resultsLifecycle).toMatchObject({
      state: "RESULTS-RETRYING",
      attempt: 2,
      maxAttempts: 4,
      delayedVariant: true,
      copyKey: "results.retrying.delayed",
    });

    sessions.createRoom({ sessionId: "room-results-failed", nowMs: 0 });
    sessions.joinRoom("room-results-failed", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-failed", 100, 150);
    sessions.completeRoom("room-results-failed", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: false,
    } as { recordedAt: number });
    const failed = sessions.getFlowState("room-results-failed");
    expect((failed as { resultsLifecycle?: Record<string, unknown> }).resultsLifecycle).toMatchObject({
      state: "RESULTS-FAILED",
      attempt: 4,
      maxAttempts: 4,
      acknowledgementRequired: true,
      acknowledged: false,
      rematchEnabled: false,
      copyKey: "results.failed.terminal",
    });

    sessions.createRoom({ sessionId: "room-results-failed-ack", nowMs: 0 });
    sessions.joinRoom("room-results-failed-ack", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-failed-ack", 100, 150);
    sessions.completeRoom("room-results-failed-ack", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: true,
    } as { recordedAt: number });
    const failedAck = sessions.getFlowState("room-results-failed-ack");
    expect((failedAck as { resultsLifecycle?: Record<string, unknown> }).resultsLifecycle).toMatchObject({
      state: "RESULTS-FAILED",
      acknowledged: true,
      rematchEnabled: true,
      syncPendingChip: true,
    });
  });

  it("blocks failed-results post-match actions until acknowledgement and then allows deterministic routing", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-post-match-gated", nowMs: 0 });
    sessions.joinRoom("room-post-match-gated", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.joinRoom("room-post-match-gated", "beta", { nowMs: 20, spawnHeight: 8.5 });
    sessions.advanceRoom("room-post-match-gated", 100, 150);
    sessions.completeRoom("room-post-match-gated", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: false,
    } as { recordedAt: number });

    const beforeSelection = sessions.getFlowState("room-post-match-gated");
    const gatedRevision = beforeSelection.revision;

    const blockedReplay = sessions.selectPostMatchAction("room-post-match-gated", "REPLAY_MATCH", 1_000);
    expect(blockedReplay).toMatchObject({
      actionId: "REPLAY_MATCH",
      routeTarget: "pre_match.ready_check",
      reason: "results_failure_ack_required",
      blocked: true,
      resultsLifecycleState: "RESULTS-FAILED",
      acknowledgementRequired: true,
      acknowledged: false,
      rematchEnabled: false,
      copyKey: "results.failed.terminal",
      guidanceCopy:
        "Acknowledge leaderboard sync warning first. Rematch and routing unlock immediately after acknowledgement.",
    });

    const blockedBack = sessions.selectPostMatchAction("room-post-match-gated", "BACK_TO_LOBBY", 1_010);
    expect(blockedBack).toMatchObject({
      actionId: "BACK_TO_LOBBY",
      routeTarget: "pre_match.lobby_ready",
      reason: "results_failure_ack_required",
      blocked: true,
    });
    const blockedMenu = sessions.selectPostMatchAction("room-post-match-gated", "EXIT_TO_MENU", 1_015);
    expect(blockedMenu).toMatchObject({
      actionId: "EXIT_TO_MENU",
      routeTarget: "shell.main_menu",
      reason: "results_failure_ack_required",
      blocked: true,
    });

    const stillGated = sessions.getFlowState("room-post-match-gated");
    expect(stillGated.revision).toBe(gatedRevision);
    expect((stillGated as { postMatchActions?: Record<string, unknown> }).postMatchActions).toMatchObject({
      routeState: "idle",
      selected: null,
    });

    expect(sessions.acknowledgeResultsFailure("room-post-match-gated", 1_020)).toMatchObject({
      state: "RESULTS-FAILED",
      acknowledged: true,
      rematchEnabled: true,
      syncPendingChip: true,
    });

    const selected = sessions.selectPostMatchAction("room-post-match-gated", "EXIT_TO_MENU", 1_030);
    expect(selected).toMatchObject({
      actionId: "EXIT_TO_MENU",
      routeTarget: "shell.main_menu",
      reason: "player_selected",
      selectedAtMs: 1_030,
    });
  });

  it("transitions retrying results lifecycle to terminal failure and enforces one-time acknowledgement gate", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-results-retrying-to-failed", nowMs: 0 });
    sessions.joinRoom("room-results-retrying-to-failed", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-retrying-to-failed", 100, 150);
    sessions.completeRoom("room-results-retrying-to-failed", {
      recordedAt: 900,
      commitLatencyMs: 2_200,
      retryAttempt: 2,
      retryMaxAttempts: 4,
    } as { recordedAt: number });

    const failed = sessions.markResultsFailedTerminal("room-results-retrying-to-failed", {
      nowMs: 1_000,
      elapsedMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
    });
    expect(failed).toMatchObject({
      state: "RESULTS-FAILED",
      copyKey: "results.failed.terminal",
      attempt: 4,
      maxAttempts: 4,
      acknowledgementRequired: true,
      acknowledged: false,
      rematchEnabled: false,
      syncPendingChip: false,
      recoveredTransition: null,
    });

    const blocked = sessions.selectPostMatchAction("room-results-retrying-to-failed", "EXIT_TO_MENU", 1_010);
    expect(blocked).toMatchObject({
      actionId: "EXIT_TO_MENU",
      routeTarget: "shell.main_menu",
      reason: "results_failure_ack_required",
      blocked: true,
    });

    expect(sessions.acknowledgeResultsFailure("room-results-retrying-to-failed", 1_020)).toMatchObject({
      state: "RESULTS-FAILED",
      acknowledged: true,
      rematchEnabled: true,
      syncPendingChip: true,
    });

    const selected = sessions.selectPostMatchAction("room-results-retrying-to-failed", "EXIT_TO_MENU", 1_030);
    expect(selected).toMatchObject({
      actionId: "EXIT_TO_MENU",
      routeTarget: "shell.main_menu",
      reason: "player_selected",
      selectedAtMs: 1_030,
    });

    const failedEvents = eventSink.list({ type: "session.results.failed_terminal" });
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]?.payload).toMatchObject({
      sessionId: "room-results-retrying-to-failed",
      previousState: "RESULTS-RETRYING",
      previousCopyKey: "results.retrying.active",
      attempt: 4,
      maxAttempts: 4,
    });
  });

  it("transitions retrying lifecycle into TS-SERVICE-RECOVERED with retry metadata preserved", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-results-retrying-to-recovered", nowMs: 0 });
    sessions.joinRoom("room-results-retrying-to-recovered", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-retrying-to-recovered", 100, 150);
    sessions.completeRoom("room-results-retrying-to-recovered", {
      recordedAt: 900,
      commitLatencyMs: 2_200,
      retryAttempt: 2,
      retryMaxAttempts: 4,
    } as { recordedAt: number });

    const recovered = sessions.markResultsRecovered("room-results-retrying-to-recovered", 1_000);
    expect(recovered).toMatchObject({
      state: "RESULTS-NORMAL",
      copyKey: "results.normal.final_placement",
      attempt: 2,
      maxAttempts: 4,
      syncPendingChip: false,
      rematchEnabled: true,
      recoveredTransition: {
        stateId: "TS-SERVICE-RECOVERED",
        reason: "leaderboard_commit_succeeded_after_retry_or_failure",
        copyKey: "results.recovered.toast",
        toastDurationMs: 4_000,
      },
    });

    const recoveredEvents = eventSink.list({ type: "session.results.recovered" });
    expect(recoveredEvents).toHaveLength(1);
    expect(recoveredEvents[0]?.payload).toMatchObject({
      sessionId: "room-results-retrying-to-recovered",
      previousState: "RESULTS-RETRYING",
      previousCopyKey: "results.retrying.active",
      toastDurationMs: 4_000,
      clearsSyncPendingChip: true,
    });
  });

  it("emits explicit TS-SERVICE-RECOVERED transition payload and clears sync-pending chip", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-results-recovered-transition", nowMs: 0 });
    sessions.joinRoom("room-results-recovered-transition", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-results-recovered-transition", 100, 150);
    sessions.completeRoom("room-results-recovered-transition", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: true,
    } as { recordedAt: number });

    const beforeRecovery = sessions.getFlowState("room-results-recovered-transition");
    expect((beforeRecovery as { resultsLifecycle?: Record<string, unknown> }).resultsLifecycle).toMatchObject({
      state: "RESULTS-FAILED",
      syncPendingChip: true,
      recoveredTransition: null,
    });

    const recovered = sessions.markResultsRecovered("room-results-recovered-transition", 1_000);
    expect(recovered).toMatchObject({
      state: "RESULTS-NORMAL",
      copyKey: "results.normal.final_placement",
      syncPendingChip: false,
      rematchEnabled: true,
      recoveredTransition: {
        stateId: "TS-SERVICE-RECOVERED",
        reason: "leaderboard_commit_succeeded_after_retry_or_failure",
        copyKey: "results.recovered.toast",
        toastDurationMs: 4_000,
        clearsSyncPendingChip: true,
      },
    });

    const afterRecovery = sessions.getFlowState("room-results-recovered-transition");
    expect(afterRecovery.revision).toBe(beforeRecovery.revision + 1);
    expect((afterRecovery as { resultsLifecycle?: Record<string, unknown> }).resultsLifecycle).toMatchObject({
      state: "RESULTS-NORMAL",
      syncPendingChip: false,
      recoveredTransition: {
        stateId: "TS-SERVICE-RECOVERED",
        toastDurationMs: 4_000,
      },
    });
  });

  it("models elimination transitions from impact to actions to auto-routed results", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-elim-contract", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-elim-contract", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-elim-contract", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.advanceRoom("room-elim-contract", 100, 100);

    const disconnect = sessions.disconnectPlayer("room-elim-contract", "alpha", { nowMs: 200 });
    sessions.advanceRoom("room-elim-contract", 100, 1_250);

    expect(
      sessions.reconnectPlayer("room-elim-contract", disconnect.resumeToken, {
        nowMs: 1_260,
      }),
    ).toMatchObject({
      connected: false,
      reason: "token_expired",
      playerId: "alpha",
    });

    const impact = sessions.getFlowState("room-elim-contract");
    expect((impact as { eliminationTransition?: Record<string, unknown> }).eliminationTransition).toMatchObject({
      state: "ELIM-IMPACT",
      eliminationCause: "disconnected",
      impactDurationMs: 1_200,
      actionsTimeoutMs: 6_000,
      autoRouteTarget: "results_screen",
      headlineCopy: "Eliminated",
      helperCopy: "You can spectate now or view results.",
    });

    sessions.advanceRoom("room-elim-contract", 100, 2_451);
    const actions = sessions.getFlowState("room-elim-contract");
    expect((actions as { eliminationTransition?: Record<string, unknown> }).eliminationTransition).toMatchObject({
      state: "ELIM-ACTIONS",
      actionCtas: [
        {
          id: "VIEW_RESULTS",
          label: "View Results",
          routeTarget: "results_screen",
          style: "primary",
          outcomeCopy: "Open results now to review final placement and leaderboard outcome.",
        },
        {
          id: "SPECTATE",
          label: "Spectate",
          routeTarget: "spectator_mode",
          style: "secondary",
          outcomeCopy: "Enter spectator mode and keep watching current match.",
        },
      ],
    });

    sessions.advanceRoom("room-elim-contract", 100, 8_451);
    const autoRouted = sessions.getFlowState("room-elim-contract");
    expect((autoRouted as { eliminationTransition?: Record<string, unknown> }).eliminationTransition).toMatchObject({
      state: "ELIM-AUTO-RESULTS",
      route: {
        routeTarget: "results_screen",
        reason: "inactivity_timeout",
      },
      autoRouteCopy: "View Results",
    });
  });

  it("cancels elimination auto-route immediately when player selects CTA", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-elim-manual-cancel", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-elim-manual-cancel", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-elim-manual-cancel", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.advanceRoom("room-elim-manual-cancel", 100, 100);

    const disconnect = sessions.disconnectPlayer("room-elim-manual-cancel", "alpha", { nowMs: 200 });
    sessions.advanceRoom("room-elim-manual-cancel", 100, 1_250);
    sessions.reconnectPlayer("room-elim-manual-cancel", disconnect.resumeToken, { nowMs: 1_260 });
    sessions.advanceRoom("room-elim-manual-cancel", 100, 2_451);

    const selected = sessions.selectEliminationAction("room-elim-manual-cancel", "VIEW_RESULTS", 2_500);
    expect(selected).toMatchObject({
      actionId: "VIEW_RESULTS",
      routeTarget: "results_screen",
      reason: "player_selected",
      selectedAtMs: 2_500,
    });

    sessions.advanceRoom("room-elim-manual-cancel", 10_000, 12_500);
    const flowState = sessions.getFlowState("room-elim-manual-cancel");
    expect((flowState as { eliminationTransition?: Record<string, unknown> }).eliminationTransition).toMatchObject({
      state: "ELIM-MANUAL-RESULTS",
      route: {
        actionId: "VIEW_RESULTS",
        routeTarget: "results_screen",
        reason: "player_selected",
        selectedAtMs: 2_500,
      },
    });
  });

  it("transitions eliminated players into explicit spectator state after spectate CTA selection", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-elim-spectator", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-elim-spectator", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-elim-spectator", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.advanceRoom("room-elim-spectator", 100, 100);

    const disconnect = sessions.disconnectPlayer("room-elim-spectator", "alpha", { nowMs: 200 });
    sessions.advanceRoom("room-elim-spectator", 100, 1_250);
    sessions.reconnectPlayer("room-elim-spectator", disconnect.resumeToken, { nowMs: 1_260 });
    sessions.advanceRoom("room-elim-spectator", 100, 2_500);

    const selected = sessions.selectEliminationAction("room-elim-spectator", "SPECTATE", 2_600);
    expect(selected).toMatchObject({
      actionId: "SPECTATE",
      routeTarget: "spectator_mode",
      reason: "player_selected",
      selectedAtMs: 2_600,
    });

    const spectatorState = sessions.getFlowState("room-elim-spectator");
    expect((spectatorState as { eliminationTransition?: Record<string, unknown> }).eliminationTransition).toMatchObject({
      state: "ELIM-SPECTATOR",
      route: {
        actionId: "SPECTATE",
        routeTarget: "spectator_mode",
        reason: "player_selected",
      },
    });
  });

  it("sets post-match route_pending and keeps repeated taps idempotent while pending", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-post-match-routes", nowMs: 0 });
    sessions.joinRoom("room-post-match-routes", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.joinRoom("room-post-match-routes", "beta", { nowMs: 20, spawnHeight: 8.5 });
    sessions.submitInput("room-post-match-routes", "alpha", { sequence: 1, thrust: 0.2 }, 40);
    sessions.submitInput("room-post-match-routes", "beta", { sequence: 1, thrust: 0.1 }, 45);
    sessions.advanceRoom("room-post-match-routes", 1_000, 1_100);
    sessions.completeRoom("room-post-match-routes", { recordedAt: 2_000 });

    const results = sessions.getFlowState("room-post-match-routes");
    expect((results as { postMatchActions?: { available?: Array<Record<string, unknown>> } }).postMatchActions).toMatchObject(
      {
        available: [
          {
            id: "REPLAY_MATCH",
            label: "Replay Match",
            routeTarget: "pre_match.ready_check",
            style: "primary",
            outcomeCopy:
              "Start rematch ready-check in same lobby and respawn all players when countdown begins.",
          },
          {
            id: "BACK_TO_LOBBY",
            label: "Back to Lobby",
            routeTarget: "pre_match.lobby_ready",
            style: "secondary",
            outcomeCopy: "Return to lobby roster without exiting current room.",
          },
          {
            id: "EXIT_TO_MENU",
            label: "Exit to Menu",
            routeTarget: "shell.main_menu",
            style: "secondary",
            outcomeCopy: "Leave room and clear rematch intent.",
          },
        ],
        guidanceCopy: "Choose your next step. You can rematch now or leave the room.",
        routeState: "idle",
      },
    );

    const initialRevision = results.revision;
    expect(sessions.selectPostMatchAction("room-post-match-routes", "REPLAY_MATCH", 2_100)).toMatchObject({
      actionId: "REPLAY_MATCH",
      routeTarget: "pre_match.ready_check",
      reason: "player_selected",
      outcomeCopy: "Start rematch ready-check in same lobby and respawn all players when countdown begins.",
    });

    const afterReplay = sessions.getFlowState("room-post-match-routes");
    expect((afterReplay as { postMatchActions?: { selected?: Record<string, unknown> } }).postMatchActions?.selected).toMatchObject(
      {
        actionId: "REPLAY_MATCH",
        routeTarget: "pre_match.ready_check",
      },
    );
    expect((afterReplay as { postMatchActions?: { routeState?: string } }).postMatchActions?.routeState).toBe(
      "route_pending",
    );
    expect(afterReplay.revision).toBe(initialRevision + 1);

    const repeatedTap = sessions.selectPostMatchAction("room-post-match-routes", "BACK_TO_LOBBY", 2_200);
    expect(repeatedTap).toMatchObject({
      actionId: "REPLAY_MATCH",
      routeTarget: "pre_match.ready_check",
      reason: "player_selected",
      selectedAtMs: 2_100,
    });

    const afterRepeatedTap = sessions.getFlowState("room-post-match-routes");
    expect(afterRepeatedTap.revision).toBe(afterReplay.revision);
    expect((afterRepeatedTap as { postMatchActions?: { selected?: Record<string, unknown> } }).postMatchActions?.selected).toMatchObject(
      {
        actionId: "REPLAY_MATCH",
        routeTarget: "pre_match.ready_check",
        selectedAtMs: 2_100,
      },
    );
  });

  it("publishes accessibility live-region semantics for critical and non-critical HUD/results states", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-a11y-warning", nowMs: 0 });
    sessions.joinRoom("room-a11y-warning", "alpha", { nowMs: 10, spawnHeight: 1.8 });
    sessions.joinRoom("room-a11y-warning", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.advanceRoom("room-a11y-warning", 100, 150);

    const warning = sessions.getFlowState("room-a11y-warning");
    expect((warning as { accessibility?: Record<string, unknown> }).accessibility).toMatchObject({
      hudAnnouncement: {
        politeness: "polite",
        role: "status",
        ariaAtomic: true,
      },
      resultsAnnouncement: {
        politeness: "off",
        role: "none",
        ariaAtomic: false,
      },
    });

    sessions.createRoom({ sessionId: "room-a11y-failed", nowMs: 0 });
    sessions.joinRoom("room-a11y-failed", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-a11y-failed", 100, 150);
    sessions.completeRoom("room-a11y-failed", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: false,
    } as { recordedAt: number });

    const failed = sessions.getFlowState("room-a11y-failed");
    expect((failed as { accessibility?: Record<string, unknown> }).accessibility).toMatchObject({
      resultsAnnouncement: {
        politeness: "assertive",
        role: "alert",
        ariaAtomic: true,
      },
      recoveryToastAnnouncement: null,
    });

    sessions.createRoom({ sessionId: "room-a11y-recovered", nowMs: 0 });
    sessions.joinRoom("room-a11y-recovered", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-a11y-recovered", 100, 150);
    sessions.completeRoom("room-a11y-recovered", {
      recordedAt: 900,
      commitLatencyMs: 2_200,
      retryAttempt: 2,
      retryMaxAttempts: 4,
    } as { recordedAt: number });
    sessions.markResultsRecovered("room-a11y-recovered", 1_000);

    const recovered = sessions.getFlowState("room-a11y-recovered");
    expect((recovered as { accessibility?: Record<string, unknown> }).accessibility).toMatchObject({
      resultsAnnouncement: {
        politeness: "off",
        role: "none",
        ariaAtomic: false,
      },
      recoveryToastAnnouncement: {
        politeness: "polite",
        role: "status",
        ariaAtomic: true,
      },
    });
  });

  it("keeps deterministic accessibility focus order for elimination and results action surfaces", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-a11y-focus-elim", nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom("room-a11y-focus-elim", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom("room-a11y-focus-elim", "beta", { nowMs: 20, spawnHeight: 8 });
    sessions.advanceRoom("room-a11y-focus-elim", 100, 100);

    const disconnect = sessions.disconnectPlayer("room-a11y-focus-elim", "alpha", { nowMs: 200 });
    sessions.advanceRoom("room-a11y-focus-elim", 100, 1_250);
    sessions.reconnectPlayer("room-a11y-focus-elim", disconnect.resumeToken, { nowMs: 1_260 });
    sessions.advanceRoom("room-a11y-focus-elim", 100, 2_451);

    const elimActions = sessions.getFlowState("room-a11y-focus-elim");
    expect((elimActions as { accessibility?: { focusOrder?: Record<string, unknown> } }).accessibility?.focusOrder)
      .toMatchObject({
        eliminationActions: ["elimination_heading", "VIEW_RESULTS", "SPECTATE"],
      });

    sessions.createRoom({ sessionId: "room-a11y-focus-results", nowMs: 0 });
    sessions.joinRoom("room-a11y-focus-results", "alpha", { nowMs: 10, spawnHeight: 9 });
    sessions.advanceRoom("room-a11y-focus-results", 100, 150);
    sessions.completeRoom("room-a11y-focus-results", {
      recordedAt: 900,
      commitLatencyMs: 8_200,
      retryAttempt: 4,
      retryMaxAttempts: 4,
      commitFailedTerminal: true,
      failureAcknowledged: false,
    } as { recordedAt: number });

    const results = sessions.getFlowState("room-a11y-focus-results");
    expect((results as { accessibility?: { focusOrder?: Record<string, unknown> } }).accessibility?.focusOrder)
      .toMatchObject({
        resultsActions: ["results_heading", "REPLAY_MATCH", "BACK_TO_LOBBY", "EXIT_TO_MENU"],
        resultsFailureAlert: ["results_failure_heading", "acknowledge_button", "view_details_button"],
      });
  });

  it("publishes parity metadata/version on runtime UX payload across phases", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-parity-meta", nowMs: 0 });

    const lobby = sessions.getFlowState("room-parity-meta");
    expect((lobby as { parityMetadata?: Record<string, unknown> }).parityMetadata).toMatchObject({
      specVersion: "1.0.0",
      sourceIssue: "WIS-73",
    });

    sessions.joinRoom("room-parity-meta", "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.advanceRoom("room-parity-meta", 100, 120);
    sessions.completeRoom("room-parity-meta", { recordedAt: 500 });

    const results = sessions.getFlowState("room-parity-meta");
    expect((results as { parityMetadata?: Record<string, unknown> }).parityMetadata).toMatchObject({
      specVersion: "1.0.0",
      sourceIssue: "WIS-73",
      fixturePath: "docs/multiplayer-state-ux-acceptance.fixture.json",
    });
  });
});
