import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WIS215_FIRST_SESSION_ONBOARDING_CUES,
  WIS215_FIRST_SESSION_ONBOARDING_ORDER,
} from "../src/ux/wis215-first-session-onboarding-contract";

interface Wis215Fixture {
  cueOrder?: typeof WIS215_FIRST_SESSION_ONBOARDING_ORDER;
  cues?: typeof WIS215_FIRST_SESSION_ONBOARDING_CUES;
}

function loadWis215Fixture(): Wis215Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-215-first-session-onboarding.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis215Fixture;
}

describe("WIS-215 first-session onboarding cue contract", () => {
  it("locks cue ordering and copy contract to fixture", () => {
    const fixture = loadWis215Fixture();

    expect(fixture.cueOrder).toEqual(WIS215_FIRST_SESSION_ONBOARDING_ORDER);
    expect(fixture.cues).toEqual(WIS215_FIRST_SESSION_ONBOARDING_CUES);
  });
});
