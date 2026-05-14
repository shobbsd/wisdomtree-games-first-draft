import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { WIS97_CRITICAL_MICROCOPY_BY_KEY } from "../src/ux/wis97-critical-microcopy";

interface Wis97Fixture {
  criticalMicrocopyLock?: {
    source?: string;
    keys?: Record<string, string>;
  };
}

function loadWis97Fixture(): Wis97Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-97-multiplayer-hud-leaderboard.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis97Fixture;
}

describe("WIS-97 critical microcopy lock", () => {
  it("exports an explicit keyed mapping for WIS-104 rubric selectors", () => {
    const fixture = loadWis97Fixture();

    expect(fixture.criticalMicrocopyLock?.source).toBe("src/ux/wis97-critical-microcopy.ts");
    expect(fixture.criticalMicrocopyLock?.keys).toEqual(WIS97_CRITICAL_MICROCOPY_BY_KEY);
  });

  it("keeps the canonical keyset stable", () => {
    const fixture = loadWis97Fixture();

    expect(Object.keys(fixture.criticalMicrocopyLock?.keys ?? {})).toHaveLength(
      Object.keys(WIS97_CRITICAL_MICROCOPY_BY_KEY).length,
    );
    expect(Object.values(fixture.criticalMicrocopyLock?.keys ?? {})).toEqual(
      Object.values(WIS97_CRITICAL_MICROCOPY_BY_KEY),
    );
  });
});

