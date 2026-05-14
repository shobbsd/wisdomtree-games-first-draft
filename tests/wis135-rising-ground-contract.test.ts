import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";
import {
  WIS135_RISING_GROUND_COPY,
  WIS135_RISING_GROUND_EVENT_NAMES,
  WIS135_RISING_GROUND_TIMING_MS,
} from "../src/ux/wis135-rising-ground-contract";

interface Wis135Fixture {
  copy?: {
    normal?: string;
    warning?: string;
    critical?: string;
    eliminated?: {
      status?: string;
      cause?: string;
      helper?: string;
      actions?: string[];
    };
  };
  events?: string[];
  timingMs?: {
    warningMinDwell?: number;
    criticalMinDwell?: number;
    eliminationImpact?: number;
    eliminationAutoRoute?: number;
    sameTierDebounce?: number;
  };
}

function loadWis135Fixture(): Wis135Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-135-rising-ground-escalation-elimination.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis135Fixture;
}

describe("WIS-135 rising-ground contract", () => {
  it("locks canonical copy/event names/timings to fixture", () => {
    const fixture = loadWis135Fixture();

    expect(fixture.copy).toEqual({
      normal: WIS135_RISING_GROUND_COPY.normal,
      warning: WIS135_RISING_GROUND_COPY.warning,
      critical: WIS135_RISING_GROUND_COPY.critical,
      eliminated: {
        status: WIS135_RISING_GROUND_COPY.eliminated.status,
        cause: WIS135_RISING_GROUND_COPY.eliminated.cause,
        helper: WIS135_RISING_GROUND_COPY.eliminated.helper,
        actions: [...WIS135_RISING_GROUND_COPY.eliminated.actions],
      },
    });
    expect(fixture.events).toEqual([
      WIS135_RISING_GROUND_EVENT_NAMES.normalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.warningEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.deescalate,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute,
    ]);
    expect(fixture.timingMs).toEqual({
      warningMinDwell: WIS135_RISING_GROUND_TIMING_MS.warningMinDwell,
      criticalMinDwell: WIS135_RISING_GROUND_TIMING_MS.criticalMinDwell,
      eliminationImpact: WIS135_RISING_GROUND_TIMING_MS.eliminationImpact,
      eliminationAutoRoute: WIS135_RISING_GROUND_TIMING_MS.eliminationAutoRoute,
      sameTierDebounce: WIS135_RISING_GROUND_TIMING_MS.sameTierDebounce,
    });
  });

  it("emits deterministic rising-ground escalation + elimination runtime events in canonical order", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-wis135", nowMs: 0 });
    sessions.joinRoom("room-wis135", "alpha", { nowMs: 10, spawnHeight: 6 });

    sessions.submitInput("room-wis135", "alpha", { sequence: 1, thrust: 1 }, 20);

    sessions.advanceRoom("room-wis135", 100, 100);
    sessions.advanceRoom("room-wis135", 1_600, 1_700);
    sessions.advanceRoom("room-wis135", 1_900, 3_600);

    sessions.submitInput("room-wis135", "alpha", { sequence: 2, thrust: -1 }, 3_610);
    sessions.advanceRoom("room-wis135", 3_000, 6_600);

    sessions.advanceRoom("room-wis135", 100, 7_801);
    sessions.advanceRoom("room-wis135", 100, 13_850);

    const canonicalEvents = eventSink
      .list()
      .filter((event) =>
        [
          WIS135_RISING_GROUND_EVENT_NAMES.normalEnter,
          WIS135_RISING_GROUND_EVENT_NAMES.warningEnter,
          WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter,
          WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered,
          WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown,
          WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute,
        ].includes(event.type),
      );

    expect(canonicalEvents.map((event) => event.type)).toEqual([
      WIS135_RISING_GROUND_EVENT_NAMES.normalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.warningEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown,
      WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute,
    ]);

    expect(canonicalEvents[0]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      dangerTier: expect.stringMatching(/LOW|MED/),
    });
    expect(canonicalEvents[1]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      dangerTier: "WARNING",
    });
    expect(canonicalEvents[2]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      dangerTier: "CRITICAL",
    });
    expect(canonicalEvents[3]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      cause: "rising_ground",
    });
    expect(canonicalEvents[4]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      actions: ["spectate", "view_leaderboard"],
    });
    expect(canonicalEvents[5]?.payload).toMatchObject({
      matchId: "room-wis135",
      playerId: "alpha",
      route: "view_leaderboard",
      trigger: "timeout",
    });

    const actionsShownAtMs = (canonicalEvents[4]?.payload as { shownAtMs?: number } | undefined)?.shownAtMs ?? 0;
    const autoElapsedMs = (canonicalEvents[5]?.payload as { elapsedMs?: number } | undefined)?.elapsedMs ?? 0;

    expect(actionsShownAtMs).toBeGreaterThanOrEqual(6_600 + WIS135_RISING_GROUND_TIMING_MS.eliminationImpact);
    expect(autoElapsedMs).toBeGreaterThanOrEqual(WIS135_RISING_GROUND_TIMING_MS.eliminationAutoRoute);
  });
});
