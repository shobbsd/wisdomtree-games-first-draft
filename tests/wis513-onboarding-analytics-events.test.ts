import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";

describe("WIS-513 onboarding/degraded analytics events", () => {
  it("emits onboarding funnel start, step_complete, and complete events", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    const sessionId = "room-wis513-onboarding";

    sessions.createRoom({ sessionId, nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 2 });
    sessions.markTransportConnectFailed(sessionId, 20);
    sessions.acknowledgeOnboardingCue(sessionId, "alpha", "OB-QUEUE-FALLBACK", 30);

    sessions.joinRoom(sessionId, "beta", { nowMs: 40, spawnHeight: 2.1 });
    sessions.setPlayerReady(sessionId, "alpha", true, 50);
    sessions.setPlayerReady(sessionId, "beta", true, 60);
    sessions.acknowledgeOnboardingCue(sessionId, "alpha", "OB-COUNTDOWN-READY", 70);

    sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 1 }, 90);
    sessions.submitInput(sessionId, "beta", { sequence: 1, thrust: 1 }, 100);
    sessions.advanceRoom(sessionId, 2_000, 2_100);
    sessions.acknowledgeOnboardingCue(sessionId, "alpha", "OB-HAZARD-URGENCY", 2_200);

    const start = eventSink
      .list({ type: "session.onboarding.start" })
      .find((event) => (event.payload as { playerId?: string }).playerId === "alpha");
    expect(start?.payload).toMatchObject({
      sessionId,
      playerId: "alpha",
      cueId: "OB-QUEUE-FALLBACK",
    });

    const steps = eventSink
      .list({ type: "session.onboarding.step_complete" })
      .filter((event) => (event.payload as { playerId?: string }).playerId === "alpha");
    expect(steps).toHaveLength(3);
    expect(steps.map((event) => {
      const payload = event.payload as { cueId?: string; stepIndex?: number; completedSteps?: number };
      return {
        cueId: payload.cueId,
        stepIndex: payload.stepIndex,
        completedSteps: payload.completedSteps,
      };
    })).toEqual([
      { cueId: "OB-QUEUE-FALLBACK", stepIndex: 1, completedSteps: 1 },
      { cueId: "OB-COUNTDOWN-READY", stepIndex: 2, completedSteps: 2 },
      { cueId: "OB-HAZARD-URGENCY", stepIndex: 3, completedSteps: 3 },
    ]);

    const complete = eventSink
      .list({ type: "session.onboarding.complete" })
      .find((event) => (event.payload as { playerId?: string }).playerId === "alpha");
    expect(complete?.payload).toMatchObject({
      sessionId,
      playerId: "alpha",
      completedSteps: 3,
      totalSteps: 3,
    });
  });

  it("emits early-quit-before-first-full-round when reconnect expires", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    const sessionId = "room-wis513-quit";

    sessions.createRoom({ sessionId, nowMs: 0, reconnectGraceMs: 1_000 });
    sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 8 });
    sessions.joinRoom(sessionId, "beta", { nowMs: 20, spawnHeight: 8.1 });
    sessions.setPlayerReady(sessionId, "alpha", true, 30);
    sessions.setPlayerReady(sessionId, "beta", true, 40);
    sessions.advanceRoom(sessionId, 100, 100);

    sessions.disconnectPlayer(sessionId, "alpha", { nowMs: 200 });
    sessions.advanceRoom(sessionId, 100, 1_250);
    sessions.advanceRoom(sessionId, 100, 1_260);

    const earlyQuit = eventSink.list({ type: "session.onboarding.quit_before_first_full_round" });
    expect(earlyQuit).toHaveLength(1);
    expect(earlyQuit[0]?.payload).toMatchObject({
      sessionId,
      playerId: "alpha",
      source: "reconnect_expired",
    });
  });
});
