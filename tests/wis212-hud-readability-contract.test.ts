import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRIORITY_DWELL_MS, PriorityMessageChannel } from "../src/ux/priority-message-channel";
import {
  WIS212_HUD_ACCEPTANCE_CHECKS,
  WIS212_HUD_LAYOUT_PROFILES,
  WIS212_HUD_SPACING_LOCK,
  WIS212_HUD_STRESS_SCENARIOS,
  WIS212_HUD_TYPOGRAPHY_LOCK,
  evaluateHudReadability,
  resolveHudLaneFrames,
} from "../src/ux/wis212-hud-readability-contract";

interface Wis212Fixture {
  viewportProfiles?: typeof WIS212_HUD_LAYOUT_PROFILES;
  typographyLock?: typeof WIS212_HUD_TYPOGRAPHY_LOCK;
  spacingLock?: typeof WIS212_HUD_SPACING_LOCK;
  deterministicStressScenarios?: typeof WIS212_HUD_STRESS_SCENARIOS;
  acceptanceChecks?: typeof WIS212_HUD_ACCEPTANCE_CHECKS;
}

function loadWis212Fixture(): Wis212Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-212-hud-readability-stress.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis212Fixture;
}

describe("WIS-212 HUD readability hardening contract", () => {
  it("locks viewport/typography/spacing and stress scenarios to fixture", () => {
    const fixture = loadWis212Fixture();

    expect(fixture.viewportProfiles).toEqual(WIS212_HUD_LAYOUT_PROFILES);
    expect(fixture.typographyLock).toEqual(WIS212_HUD_TYPOGRAPHY_LOCK);
    expect(fixture.spacingLock).toEqual(WIS212_HUD_SPACING_LOCK);
    expect(fixture.deterministicStressScenarios).toEqual(WIS212_HUD_STRESS_SCENARIOS);
    expect(fixture.acceptanceChecks).toEqual(WIS212_HUD_ACCEPTANCE_CHECKS);
  });

  it("keeps alert lane, HUD lane, and toast lane overlap-safe at minimum viewport profiles", () => {
    for (const profile of Object.values(WIS212_HUD_LAYOUT_PROFILES)) {
      const frames = resolveHudLaneFrames(profile.id);
      const evaluation = evaluateHudReadability(profile.id);

      expect(frames.alertLane.y).toBeGreaterThanOrEqual(profile.safeArea.topPx);
      expect(frames.toastLane.y + frames.toastLane.height).toBeLessThanOrEqual(profile.heightPx - profile.safeArea.bottomPx);
      expect(evaluation.withinSafeArea).toBe(true);
      expect(evaluation.hasOverlap).toBe(false);
      expect(evaluation.hasOcclusion).toBe(false);
      expect(evaluation.hasTruncationRisk).toBe(false);
    }
  });

  it("keeps deterministic ordering and bounded replay under hazard preemption stress scenarios", () => {
    for (const scenario of WIS212_HUD_STRESS_SCENARIOS) {
      const channel = new PriorityMessageChannel({ p2QueueLimit: scenario.queueLimit.p2MaxBuffered });
      let snapshot = channel.getSnapshot();

      for (const event of scenario.events) {
        snapshot = channel.publish(
          {
            id: event.id,
            state: event.state,
            event: event.event,
            priority: event.priority,
            copy: event.copy,
          },
          event.nowMs,
        );
      }

      expect(snapshot.active?.id).toBe(scenario.expected.activeDuringBurst);
      expect(snapshot.queued.map((message) => message.id)).toEqual(scenario.expected.queuedAfterBurst);

      let replaySnapshot = channel.advance(scenario.expected.hazardStartedAtMs + PRIORITY_DWELL_MS.P0);
      for (const [index, expectedReplayId] of scenario.expected.replayOrder.entries()) {
        expect(replaySnapshot.active?.id).toBe(expectedReplayId);

        if (index < scenario.expected.replayOrder.length - 1) {
          replaySnapshot = channel.advance(replaySnapshot.active?.expiresAtMs ?? 0);
        }
      }
    }
  });
});
