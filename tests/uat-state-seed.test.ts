import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resetUatDurableState, seedDeterministicUatState } from "../src/uat/state-seed";

describe("UAT deterministic state seed", () => {
  it("resets durable state to canonical empty document", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis191-uat-reset-"));
    const stateFilePath = join(fixtureDir, "durable-state.json");

    try {
      writeFileSync(stateFilePath, "{\"version\":1,\"sessionSnapshots\":[{\"junk\":true}],\"matchFinalEvents\":[{\"junk\":true}]}", "utf8");

      const result = resetUatDurableState(stateFilePath);
      const payload = JSON.parse(readFileSync(stateFilePath, "utf8")) as {
        version: number;
        sessionSnapshots: unknown[];
        matchFinalEvents: unknown[];
      };

      expect(result.stateFilePath).toBe(stateFilePath);
      expect(payload).toEqual({
        version: 1,
        sessionSnapshots: [],
        matchFinalEvents: [],
      });
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("produces byte-identical durable state across repeated seeds", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wis191-uat-seed-"));
    const stateFilePath = join(fixtureDir, "durable-state.json");
    const summaryPath = join(fixtureDir, "seed-summary.json");

    try {
      const first = seedDeterministicUatState({
        stateFilePath,
        summaryFilePath: summaryPath,
      });
      const firstRaw = readFileSync(stateFilePath, "utf8");
      const firstSummaryRaw = readFileSync(summaryPath, "utf8");

      const second = seedDeterministicUatState({
        stateFilePath,
        summaryFilePath: summaryPath,
      });
      const secondRaw = readFileSync(stateFilePath, "utf8");
      const secondSummaryRaw = readFileSync(summaryPath, "utf8");

      expect(second).toEqual(first);
      expect(secondRaw).toBe(firstRaw);
      expect(secondSummaryRaw).toBe(firstSummaryRaw);
      expect(first.roundsSeeded).toBeGreaterThanOrEqual(2);
      expect(first.matchFinalEventCount).toBe(first.roundsSeeded);
      expect(first.standings.length).toBeGreaterThan(0);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
