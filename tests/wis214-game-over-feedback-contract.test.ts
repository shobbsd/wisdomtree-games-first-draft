import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WIS214_GAME_OVER_COPY,
  WIS214_GAME_OVER_TIMING_MS,
} from "../src/ux/wis214-game-over-feedback-contract";

interface Wis214Fixture {
  timingMs?: typeof WIS214_GAME_OVER_TIMING_MS;
  copy?: typeof WIS214_GAME_OVER_COPY;
}

function loadWis214Fixture(): Wis214Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-214-game-over-rematch-feedback.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis214Fixture;
}

describe("WIS-214 game-over/rematch feedback contract", () => {
  it("locks canonical timing + copy to fixture", () => {
    const fixture = loadWis214Fixture();

    expect(fixture.timingMs).toEqual(WIS214_GAME_OVER_TIMING_MS);
    expect(fixture.copy).toEqual(WIS214_GAME_OVER_COPY);
  });
});
