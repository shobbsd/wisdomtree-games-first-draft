import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureWis193TelemetryEvidence } from "../src/uat/wis193-telemetry-evidence";

describe("WIS-193 UAT telemetry evidence capture", () => {
  it("writes deterministic lifecycle bundle with reconnect + CTA outcomes", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis193-uat-evidence-"));
    const outputFilePath = join(fixtureDir, "WIS-193-telemetry-evidence.json");
    const generatedAt = "2026-04-15T11:31:21.397Z";

    const bundle = captureWis193TelemetryEvidence({
      outputFilePath,
      generatedAt,
    });
    const fromDisk = JSON.parse(readFileSync(outputFilePath, "utf8")) as typeof bundle;

    expect(fromDisk).toEqual(bundle);
    expect(bundle.generatedAt).toBe(generatedAt);

    const lifecycles = new Set(bundle.orderedLifecycleRecords.map((record) => record.lifecycle));
    expect(lifecycles).toEqual(
      new Set(["countdown", "warning", "critical", "elimination", "results", "reconnect", "cta route"]),
    );

    expect(bundle.orderedLifecycleRecords.map((record) => record.stateOrderIndex)).toEqual(
      bundle.orderedLifecycleRecords.map((_, index) => index + 1),
    );
    expect(bundle.orderedLifecycleRecords.every((record) => Number.isFinite(record.timestampMs))).toBe(true);

    expect(bundle.reconnectOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "success",
        }),
        expect.objectContaining({
          outcome: "timeout",
        }),
      ]),
    );

    expect(bundle.ctaRouteOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "play_again",
          destination: "pre_match.ready_check",
          destinationReached: true,
        }),
        expect.objectContaining({
          action: "back_to_lobby",
          destination: "pre_match.lobby_ready",
          destinationReached: true,
        }),
      ]),
    );
  });
});
