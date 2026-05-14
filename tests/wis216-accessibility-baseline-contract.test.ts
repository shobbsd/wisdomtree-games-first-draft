import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WIS216_ACCESSIBILITY_BASELINE,
  resolveWis216AnnouncementPolicy,
} from "../src/ux/wis216-accessibility-baseline-contract";

interface Wis216Fixture {
  baseline?: typeof WIS216_ACCESSIBILITY_BASELINE;
}

function loadWis216Fixture(): Wis216Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-216-accessibility-baseline.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis216Fixture;
}

describe("WIS-216 accessibility baseline contract", () => {
  it("locks baseline policy to fixture", () => {
    const fixture = loadWis216Fixture();
    expect(fixture.baseline).toEqual(WIS216_ACCESSIBILITY_BASELINE);
  });

  it("resolves critical and non-critical live-region semantics deterministically", () => {
    expect(resolveWis216AnnouncementPolicy({ uxStateId: "HUD-ELIMINATED" })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.critical,
    );
    expect(resolveWis216AnnouncementPolicy({ uxStateId: "HUD-ACTIVE", risingGroundState: "RG-WARNING" })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.nonCritical,
    );
    expect(resolveWis216AnnouncementPolicy({ resultsLifecycleState: "RESULTS-PENDING" })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.nonCritical,
    );
    expect(resolveWis216AnnouncementPolicy({ resultsLifecycleState: "RESULTS-FAILED" })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.critical,
    );
    expect(resolveWis216AnnouncementPolicy({ resultsLifecycleState: "RESULTS-NORMAL", hasRecoveryToast: true })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.nonCritical,
    );
    expect(resolveWis216AnnouncementPolicy({ uxStateId: "HUD-ACTIVE" })).toEqual(
      WIS216_ACCESSIBILITY_BASELINE.liveRegions.passive,
    );
  });
});
