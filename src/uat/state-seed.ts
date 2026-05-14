import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LeaderboardRecord } from "../leaderboard/leaderboard-service.js";
import { FileDurableStateStore } from "../persistence/file-durable-state-store.js";
import { createBaselineRuntime } from "../index.js";
import {
  UAT_DETERMINISTIC_SEED_ROUNDS,
  type UatSeedPlayerProfile,
  type UatSeedRoundProfile,
} from "./runtime-profile.js";

interface EmptyDurableStateDocument {
  version: 1;
  sessionSnapshots: [];
  matchFinalEvents: [];
}

export interface UatResetResult {
  stateFilePath: string;
}

export interface UatSeedSessionSummary {
  sessionId: string;
  players: number;
  advances: number;
  recordedAtMs: number;
}

export interface UatSeedSummary {
  seedProfileVersion: 1;
  stateFilePath: string;
  roundsSeeded: number;
  matchFinalEventCount: number;
  sessionSnapshotCount: number;
  sessions: UatSeedSessionSummary[];
  standings: LeaderboardRecord[];
  durableStateSha256: string;
}

export interface SeedDeterministicUatStateOptions {
  stateFilePath: string;
  summaryFilePath?: string;
}

const EMPTY_DURABLE_STATE: EmptyDurableStateDocument = {
  version: 1,
  sessionSnapshots: [],
  matchFinalEvents: [],
};

export function resetUatDurableState(stateFilePath: string): UatResetResult {
  mkdirSync(dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, `${JSON.stringify(EMPTY_DURABLE_STATE, null, 2)}\n`, "utf8");

  return { stateFilePath };
}

export function seedDeterministicUatState(options: SeedDeterministicUatStateOptions): UatSeedSummary {
  resetUatDurableState(options.stateFilePath);

  const runtime = createBaselineRuntime({
    durableStateFilePath: options.stateFilePath,
  });

  const sessionSummaries: UatSeedSessionSummary[] = [];

  for (const round of UAT_DETERMINISTIC_SEED_ROUNDS) {
    seedRound(runtime, round);
    sessionSummaries.push({
      sessionId: round.sessionId,
      players: round.players.length,
      advances: round.advanceDeltasMs.length,
      recordedAtMs: round.recordedAtMs,
    });
  }

  const durableStore = new FileDurableStateStore({
    filePath: options.stateFilePath,
  });
  const rawState = readFileSync(options.stateFilePath, "utf8");

  const summary: UatSeedSummary = {
    seedProfileVersion: 1,
    stateFilePath: options.stateFilePath,
    roundsSeeded: UAT_DETERMINISTIC_SEED_ROUNDS.length,
    matchFinalEventCount: durableStore.listMatchFinalEvents().length,
    sessionSnapshotCount: durableStore.listSessionSnapshots().length,
    sessions: sessionSummaries,
    standings: runtime.leaderboard.getStandings(50),
    durableStateSha256: createHash("sha256").update(rawState).digest("hex"),
  };

  if (options.summaryFilePath) {
    mkdirSync(dirname(options.summaryFilePath), { recursive: true });
    writeFileSync(options.summaryFilePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  return summary;
}

function seedRound(
  runtime: ReturnType<typeof createBaselineRuntime>,
  round: UatSeedRoundProfile,
): void {
  runtime.sessions.createRoom({
    sessionId: round.sessionId,
    nowMs: round.createdAtMs,
    reconnectTokenSecret: `uat-seed:${round.sessionId}`,
  });

  let currentTimeMs = round.createdAtMs;

  round.players.forEach((player, index) => {
    joinAndPrimePlayer(runtime, round.sessionId, player, currentTimeMs + index);
  });

  for (const deltaMs of round.advanceDeltasMs) {
    currentTimeMs += deltaMs;
    runtime.sessions.advanceRoom(round.sessionId, deltaMs, currentTimeMs);
  }

  runtime.sessions.completeRoom(round.sessionId, {
    recordedAt: round.recordedAtMs,
  });
}

function joinAndPrimePlayer(
  runtime: ReturnType<typeof createBaselineRuntime>,
  sessionId: string,
  player: UatSeedPlayerProfile,
  nowMs: number,
): void {
  runtime.sessions.joinRoom(sessionId, player.playerId, {
    nowMs,
    spawnHeight: player.spawnHeight,
  });

  runtime.sessions.submitInput(
    sessionId,
    player.playerId,
    {
      sequence: 1,
      thrust: player.thrust,
    },
    nowMs + 1,
  );
}
