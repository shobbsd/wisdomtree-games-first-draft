import { describe, expect, it } from "vitest";

import {
  resolveControlIntent,
  resolveDirectionalControlIntent,
  resolveSurfaceMode,
  resolveSpriteAnimationState,
  renderBrowserPlayableHtml,
  type BrowserControlState,
} from "../src/playable/browser-shell";

function controlState(overrides: Partial<BrowserControlState> = {}): BrowserControlState {
  return {
    keyboardLiftActive: false,
    keyboardDropActive: false,
    keyboardLeftActive: false,
    keyboardRightActive: false,
    touchMode: "none",
    ...overrides,
  };
}

describe("WIS-483 browser playable shell helpers", () => {
  it("resolves auto surface mode for coarse-pointer and compact viewports", () => {
    expect(resolveSurfaceMode("auto", { viewportWidth: 480, coarsePointer: false })).toBe("mobile");
    expect(resolveSurfaceMode("auto", { viewportWidth: 1280, coarsePointer: true })).toBe("mobile");
    expect(resolveSurfaceMode("auto", { viewportWidth: 1280, coarsePointer: false })).toBe("desktop");
  });

  it("honors explicit surface preference overrides", () => {
    expect(resolveSurfaceMode("desktop", { viewportWidth: 480, coarsePointer: true })).toBe("desktop");
    expect(resolveSurfaceMode("mobile", { viewportWidth: 1920, coarsePointer: false })).toBe("mobile");
  });

  it("maps keyboard and touch controls into directional intent deterministically", () => {
    expect(resolveDirectionalControlIntent(controlState({ keyboardLiftActive: true }))).toEqual({
      thrust: 1,
      horizontal: 0,
    });
    expect(resolveDirectionalControlIntent(controlState({ keyboardDropActive: true }))).toEqual({
      thrust: -0.5,
      horizontal: 0,
    });
    expect(resolveDirectionalControlIntent(controlState({ keyboardRightActive: true }))).toEqual({
      thrust: 0,
      horizontal: 1,
    });
    expect(resolveDirectionalControlIntent(controlState({ keyboardLeftActive: true, keyboardLiftActive: true }))).toEqual({
      thrust: 1,
      horizontal: -1,
    });
    expect(resolveDirectionalControlIntent(controlState({ touchMode: "up" }))).toEqual({
      thrust: 1,
      horizontal: 0,
    });
    expect(resolveDirectionalControlIntent(controlState({ touchMode: "down" }))).toEqual({
      thrust: -0.5,
      horizontal: 0,
    });
    expect(resolveDirectionalControlIntent(controlState({ touchMode: "left" }))).toEqual({
      thrust: 0,
      horizontal: -1,
    });
    expect(resolveDirectionalControlIntent(controlState({ touchMode: "right" }))).toEqual({
      thrust: 0,
      horizontal: 1,
    });
    expect(resolveDirectionalControlIntent(controlState({ touchMode: "neutral", keyboardLiftActive: true }))).toEqual({
      thrust: 0,
      horizontal: 0,
    });
    expect(resolveDirectionalControlIntent(controlState())).toEqual({
      thrust: 0,
      horizontal: 0,
    });
    expect(resolveControlIntent(controlState({ keyboardLiftActive: true }))).toBe(1);
  });

  it("resolves sprite animation state for idle/run/jump/dead transitions", () => {
    expect(
      resolveSpriteAnimationState({
        isEliminated: false,
        onPlatform: true,
        horizontalIntent: 0,
        verticalVelocity: 0,
        thrustIntent: 0,
      }),
    ).toBe("idle");

    expect(
      resolveSpriteAnimationState({
        isEliminated: false,
        onPlatform: true,
        horizontalIntent: 1,
        verticalVelocity: 0.05,
        thrustIntent: 0,
      }),
    ).toBe("run");

    expect(
      resolveSpriteAnimationState({
        isEliminated: false,
        onPlatform: false,
        horizontalIntent: 0,
        verticalVelocity: 0.3,
        thrustIntent: 1,
      }),
    ).toBe("jump_up");

    expect(
      resolveSpriteAnimationState({
        isEliminated: false,
        onPlatform: false,
        horizontalIntent: 0,
        verticalVelocity: -0.35,
        thrustIntent: -0.5,
      }),
    ).toBe("jump_down");

    expect(
      resolveSpriteAnimationState({
        isEliminated: true,
        onPlatform: false,
        horizontalIntent: 1,
        verticalVelocity: 0.2,
        thrustIntent: 1,
      }),
    ).toBe("dead");
  });

  it("renders shell html with desktop + mobile controls and config payload", () => {
    const html = renderBrowserPlayableHtml({
      title: "WIS-483 Browser Playable",
      roomId: "wis-483-room",
      transportBaseUrl: "http://127.0.0.1:7777",
      tickMs: 120,
      maxTicks: 220,
    });

    expect(html).toContain('id="keyboard-hints"');
    expect(html).toContain('id="touch-controls"');
    expect(html).toContain('id="playfield-canvas"');
    expect(html).toContain('id="playfield-overlay"');
    expect(html).toContain('data-control="up"');
    expect(html).toContain('data-control="down"');
    expect(html).toContain('data-control="left"');
    expect(html).toContain('data-control="right"');
    expect(html).toContain("window.__BROWSER_PLAYABLE_CONFIG__");
    expect(html).toContain('"sprites":{"playerYou"');
    expect(html).toContain('"hazardGround"');
    expect(html).toContain("drawSpriteFrame");
    expect(html).toContain("resolveDirectionalIntent");
    expect(html).toContain("replayRound");
    expect(html).toContain("wis-483-room");
  });

  it("renders WIS-487 authoritative HUD + post-match route-action surface", () => {
    const html = renderBrowserPlayableHtml({
      title: "WIS-487 Browser Playable",
      roomId: "wis-487-room",
      transportBaseUrl: "http://127.0.0.1:8777",
      tickMs: 120,
      maxTicks: 220,
    });

    expect(html).toContain("Your HUD");
    expect(html).toContain("Survival Time");
    expect(html).toContain("Players Left");
    expect(html).toContain("Final Placement:");
    expect(html).toContain("Choose your next step. You can rematch now or leave the room.");
    expect(html).toContain("Play Again");
    expect(html).toContain("Back to Lobby");
    expect(html).toContain("Exit to Menu");
    expect(html).toContain("Replay Match");
    expect(html).toContain("Replay started.");
    expect(html).toContain("/api/rooms/");
    expect(html).toContain("/post-match/action");
    expect(html).toContain("/elimination/action");
  });

  it("renders WIS-523 visual refresh contracts for objective, hints, elimination, and rank deltas", () => {
    const html = renderBrowserPlayableHtml({
      title: "WIS-523 Browser Playable",
      roomId: "wis-523-room",
      transportBaseUrl: "http://127.0.0.1:9777",
      tickMs: 120,
      maxTicks: 220,
    });

    expect(html).toContain("--bg-deep");
    expect(html).toContain("--surface-lane");
    expect(html).toContain("--accent-rank");
    expect(html).toContain('id="objective-ribbon"');
    expect(html).toContain('id="objective-copy"');
    expect(html).toContain('id="objective-progress"');
    expect(html).toContain('id="control-hint-dock"');
    expect(html).toContain('id="hint-lift"');
    expect(html).toContain('id="hint-drop"');
    expect(html).toContain('id="hint-left"');
    expect(html).toContain('id="hint-right"');
    expect(html).toContain('id="elim-cause"');
    expect(html).toContain('id="elim-countdown"');
    expect(html).toContain('id="elim-next-action"');
    expect(html).toContain("<th>Prev</th>");
    expect(html).toContain("<th>Now</th>");
    expect(html).toContain("<th>Δ</th>");
    expect(html).toContain("renderObjectiveRibbon");
    expect(html).toContain("renderControlHintDock");
  });
});
