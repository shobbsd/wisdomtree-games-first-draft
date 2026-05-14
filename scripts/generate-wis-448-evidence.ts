import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createBaselineRuntime, HttpRoomTransport } from "../src/index.js";
import type { PlayerSnapshot } from "../src/types.js";

interface SyncAnchor {
  revision: number;
  tick: number;
  stateHash: string;
}

interface RequestOptions {
  method: "GET" | "POST";
  authToken?: string;
  body?: unknown;
}

interface HudPlayerFields {
  rank: string;
  score: number;
  survivalTime: string;
  groundSpeed: string;
  playersLeft: string;
}

interface TickSnapshot {
  tick: number;
  phase: string;
  groundHeight: number;
  groundSpeedMultiplier: number;
  target: HudPlayerFields;
  opponent: HudPlayerFields;
  risingGround: {
    state: string | null;
    copy: string | null;
    visibilityDesktop: string | null;
    visibilityMobile: string | null;
  };
  accessibility: {
    hudAnnouncement: unknown;
    focusOrder: unknown;
    acceptanceChecksCount: number;
  };
}

interface ScenarioEvidence {
  surface: "desktop" | "mobile";
  controlModel: "keyboard_like" | "touch_tap";
  roomId: string;
  targetPlayerId: string;
  opponentPlayerId: string;
  commands: string[];
  ticks: TickSnapshot[];
  finalStandings: Array<{
    rank: number;
    playerId: string;
    score: number;
    placementToken: string;
    updatedAt: number;
  }>;
  globalLeaderboardTop: Array<{
    rank: number;
    playerId: string;
    score: number;
    updatedAt: number;
  }>;
  checks: {
    roundCompletes: boolean;
    liveLeaderboardUpdatesObserved: boolean;
    leaderboardLegibilityFieldsPresent: boolean;
    surfaceVisibilityPresent: boolean;
    accessibilitySmokePresent: boolean;
  };
}

interface FlowStateLike {
  phase: string;
  revision: number;
  world: {
    tick: number;
    groundHeight: number;
    groundRiseSpeed: number;
    stateHash: string;
  };
  players: PlayerSnapshot[];
  uxState?: {
    risingGround?: {
      state?: string;
      copy?: string;
      visibility?: {
        desktop?: string;
        mobile?: string;
      };
    };
  };
  hud: {
    byPlayerId?: Record<
      string,
      {
        rank?: { value?: string };
        score?: { value?: number };
        survivalTime?: { value?: string };
        groundSpeed?: { value?: string };
        playersLeft?: { value?: string };
      }
    >;
  };
  accessibility?: {
    hudAnnouncement?: unknown;
    focusOrder?: unknown;
    baseline?: {
      acceptanceChecks?: unknown[];
    };
  };
  standings?: Array<{
    rank: number;
    playerId: string;
    score: number;
    placementToken: string;
    updatedAt: number;
  }>;
}

const OUTPUT_JSON_PATH = join(
  process.cwd(),
  "docs",
  "ux",
  "evidence",
  "WIS-448-desktop-mobile-playable-surface.json",
);

const TICK_DELTA_MS = 100;
const MAX_TICKS = 14;

async function main(): Promise<void> {
  const runtime = createBaselineRuntime({ durableStateFilePath: null });
  const transport = new HttpRoomTransport({
    sessions: runtime.sessions,
    authTokenSecret: "wis-448-transport-secret",
    now: () => 0,
  });

  try {
    const start = await transport.start({ port: 0 });
    const baseUrl = start.url;
    const generatedAt = new Date().toISOString();

    const desktopEvidence = await runScenario({
      baseUrl,
      runtime,
      surface: "desktop",
      controlModel: "keyboard_like",
      targetPlayerId: "desktop-human",
      opponentPlayerId: "desktop-bot",
      roomId: `wis-448-desktop-${Date.now().toString(36)}`,
      targetInputPattern: [0.45, 0.2, 0.6, -0.1, 0.3, 0.4],
    });

    const mobileEvidence = await runScenario({
      baseUrl,
      runtime,
      surface: "mobile",
      controlModel: "touch_tap",
      targetPlayerId: "mobile-touch",
      opponentPlayerId: "mobile-bot",
      roomId: `wis-448-mobile-${Date.now().toString(36)}`,
      targetInputPattern: [1, 0, 1, -0.2, 1, 0],
    });

    const output = {
      issue: "WIS-448",
      generatedAt,
      transportBaseUrl: baseUrl,
      commandRecipe: [
        "node --import tsx scripts/generate-wis-448-evidence.ts",
        "npm test -- tests/http-room-transport.test.ts tests/wis212-hud-readability-contract.test.ts tests/wis216-accessibility-baseline-contract.test.ts tests/wis97-critical-microcopy-lock.test.ts",
      ],
      scenarios: [desktopEvidence, mobileEvidence],
      crossSurfaceChecks: {
        bothRoundsComplete: desktopEvidence.checks.roundCompletes && mobileEvidence.checks.roundCompletes,
        bothShowLiveLeaderboardUpdates:
          desktopEvidence.checks.liveLeaderboardUpdatesObserved && mobileEvidence.checks.liveLeaderboardUpdatesObserved,
        bothPreserveSurfaceVisibilityContracts:
          desktopEvidence.checks.surfaceVisibilityPresent && mobileEvidence.checks.surfaceVisibilityPresent,
        bothCarryAccessibilitySmokeSignals:
          desktopEvidence.checks.accessibilitySmokePresent && mobileEvidence.checks.accessibilitySmokePresent,
      },
      residualRisks: [
        "Evidence validates FE contract surface through transport + flow-state snapshots, not pixel-rendered browser screenshots.",
        "Human control parity modeled via deterministic keyboard/tap input patterns through authenticated transport endpoints.",
      ],
    };

    mkdirSync(join(process.cwd(), "docs", "ux", "evidence"), { recursive: true });
    writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${OUTPUT_JSON_PATH}\n`);
  } finally {
    await transport.stop();
  }
}

interface ScenarioRunInput {
  baseUrl: string;
  runtime: ReturnType<typeof createBaselineRuntime>;
  surface: "desktop" | "mobile";
  controlModel: "keyboard_like" | "touch_tap";
  targetPlayerId: string;
  opponentPlayerId: string;
  roomId: string;
  targetInputPattern: number[];
}

async function runScenario(input: ScenarioRunInput): Promise<ScenarioEvidence> {
  const commands = [
    `POST /v1/rooms {sessionId:${input.roomId}}`,
    `POST /v1/rooms/${input.roomId}/players {playerId:${input.targetPlayerId}}`,
    `POST /v1/rooms/${input.roomId}/players {playerId:${input.opponentPlayerId}}`,
    "repeat: flow-state -> input(target) -> flow-state -> input(opponent) -> flow-state -> advance",
    `POST /v1/rooms/${input.roomId}/complete`,
  ];

  await requestJson(`${input.baseUrl}/v1/rooms`, {
    method: "POST",
    body: { sessionId: input.roomId, nowMs: 0 },
  });

  const targetJoin = await requestJson<{ authToken: string }>(`${input.baseUrl}/v1/rooms/${input.roomId}/players`, {
    method: "POST",
    body: { playerId: input.targetPlayerId, nowMs: 1, spawnHeight: 4.8 },
  });
  const opponentJoin = await requestJson<{ authToken: string }>(`${input.baseUrl}/v1/rooms/${input.roomId}/players`, {
    method: "POST",
    body: { playerId: input.opponentPlayerId, nowMs: 2, spawnHeight: 5.0 },
  });

  let targetSequence = 0;
  let opponentSequence = 0;
  let nowMs = 10;
  const ticks: TickSnapshot[] = [];

  for (let index = 0; index < MAX_TICKS; index += 1) {
    const beforeTick = await getFlowState(input.baseUrl, input.roomId);
    if (beforeTick.phase === "results") {
      break;
    }

    const targetThrust = input.targetInputPattern[index % input.targetInputPattern.length] ?? 0;
    const opponent = beforeTick.players.find((player) => player.playerId === input.opponentPlayerId);
    const opponentThrust = chooseOpponentThrust(opponent, beforeTick.world.groundHeight);

    targetSequence += 1;
    await requestJson(`${input.baseUrl}/v1/rooms/${input.roomId}/input`, {
      method: "POST",
      authToken: targetJoin.authToken,
      body: {
        sequence: targetSequence,
        thrust: targetThrust,
        nowMs,
        sync: toSync(beforeTick),
      },
    });

    const afterTargetInput = await getFlowState(input.baseUrl, input.roomId);
    opponentSequence += 1;
    await requestJson(`${input.baseUrl}/v1/rooms/${input.roomId}/input`, {
      method: "POST",
      authToken: opponentJoin.authToken,
      body: {
        sequence: opponentSequence,
        thrust: opponentThrust,
        nowMs: nowMs + 1,
        sync: toSync(afterTargetInput),
      },
    });

    const afterOpponentInput = await getFlowState(input.baseUrl, input.roomId);
    await requestJson(`${input.baseUrl}/v1/rooms/${input.roomId}/advance`, {
      method: "POST",
      body: {
        deltaMs: TICK_DELTA_MS,
        nowMs: nowMs + TICK_DELTA_MS,
        sync: toSync(afterOpponentInput),
      },
    });

    const afterAdvance = await getFlowState(input.baseUrl, input.roomId);
    ticks.push(buildTickSnapshot(afterAdvance, input.targetPlayerId, input.opponentPlayerId));
    nowMs += TICK_DELTA_MS;
  }

  const preComplete = await getFlowState(input.baseUrl, input.roomId);
  await requestJson(`${input.baseUrl}/v1/rooms/${input.roomId}/complete`, {
    method: "POST",
    body: {
      recordedAt: nowMs + 1,
      sync: toSync(preComplete),
    },
  });
  const finalFlowState = await getFlowState(input.baseUrl, input.roomId);
  const finalStandings = (finalFlowState.standings ?? []).map((entry) => ({
    rank: entry.rank,
    playerId: entry.playerId,
    score: entry.score,
    placementToken: entry.placementToken,
    updatedAt: entry.updatedAt,
  }));
  const leaderboardTop = input.runtime.leaderboard.getStandings(5).map((entry) => ({
    rank: entry.rank,
    playerId: entry.playerId,
    score: entry.score,
    updatedAt: entry.updatedAt,
  }));

  return {
    surface: input.surface,
    controlModel: input.controlModel,
    roomId: input.roomId,
    targetPlayerId: input.targetPlayerId,
    opponentPlayerId: input.opponentPlayerId,
    commands,
    ticks,
    finalStandings,
    globalLeaderboardTop: leaderboardTop,
    checks: {
      roundCompletes: finalFlowState.phase === "results" && finalStandings.length >= 2,
      liveLeaderboardUpdatesObserved: scoreChangesObserved(ticks),
      leaderboardLegibilityFieldsPresent: hudLegibilityPresent(ticks),
      surfaceVisibilityPresent: surfaceVisibilityPresent(ticks),
      accessibilitySmokePresent: accessibilitySmokePresent(ticks),
    },
  };
}

function buildTickSnapshot(
  flowState: FlowStateLike,
  targetPlayerId: string,
  opponentPlayerId: string,
): TickSnapshot {
  const targetHud = readHud(flowState, targetPlayerId);
  const opponentHud = readHud(flowState, opponentPlayerId);
  const risingGround = flowState.uxState?.risingGround;
  const acceptanceChecks = flowState.accessibility?.baseline?.acceptanceChecks ?? [];

  return {
    tick: flowState.world.tick,
    phase: flowState.phase,
    groundHeight: roundMetric(flowState.world.groundHeight),
    groundSpeedMultiplier: roundMetric(flowState.world.groundRiseSpeed / 0.5),
    target: targetHud,
    opponent: opponentHud,
    risingGround: {
      state: risingGround?.state ?? null,
      copy: risingGround?.copy ?? null,
      visibilityDesktop: risingGround?.visibility?.desktop ?? null,
      visibilityMobile: risingGround?.visibility?.mobile ?? null,
    },
    accessibility: {
      hudAnnouncement: flowState.accessibility?.hudAnnouncement ?? null,
      focusOrder: flowState.accessibility?.focusOrder ?? null,
      acceptanceChecksCount: acceptanceChecks.length,
    },
  };
}

function readHud(flowState: FlowStateLike, playerId: string): HudPlayerFields {
  const byPlayerId = flowState.hud.byPlayerId ?? {};
  const row = byPlayerId[playerId] ?? {};
  return {
    rank: row.rank?.value ?? "",
    score: row.score?.value ?? 0,
    survivalTime: row.survivalTime?.value ?? "",
    groundSpeed: row.groundSpeed?.value ?? "",
    playersLeft: row.playersLeft?.value ?? "",
  };
}

function toSync(flowState: FlowStateLike): SyncAnchor {
  return {
    revision: flowState.revision,
    tick: flowState.world.tick,
    stateHash: flowState.world.stateHash,
  };
}

async function getFlowState(baseUrl: string, roomId: string): Promise<FlowStateLike> {
  return requestJson<FlowStateLike>(`${baseUrl}/v1/rooms/${roomId}/flow-state`, {
    method: "GET",
  });
}

async function requestJson<T>(url: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const parsed = text.length ? (JSON.parse(text) as T) : (null as T);
  if (!response.ok) {
    throw new Error(`request_failed status=${response.status} url=${url} body=${text}`);
  }
  return parsed;
}

function chooseOpponentThrust(player: PlayerSnapshot | undefined, groundHeight: number): number {
  if (!player || !player.connected || player.isEliminated) {
    return 0;
  }
  const clearance = player.height - groundHeight;
  if (clearance <= 0.4 || player.velocity < -0.8) {
    return 1;
  }
  if (clearance >= 1.8 && player.velocity > 0.25) {
    return -0.2;
  }
  return 0.35;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function scoreChangesObserved(ticks: TickSnapshot[]): boolean {
  if (ticks.length < 2) {
    return false;
  }
  const targetScores = ticks.map((tick) => tick.target.score);
  const opponentScores = ticks.map((tick) => tick.opponent.score);
  return hasScoreChange(targetScores) && hasScoreChange(opponentScores);
}

function hasScoreChange(scores: number[]): boolean {
  return scores.some((score, index) => index > 0 && score !== scores[index - 1]);
}

function hudLegibilityPresent(ticks: TickSnapshot[]): boolean {
  return ticks.every((tick) => {
    const target = tick.target;
    const opponent = tick.opponent;
    return (
      target.rank.length > 0 &&
      target.survivalTime.length > 0 &&
      target.groundSpeed.length > 0 &&
      target.playersLeft.length > 0 &&
      opponent.rank.length > 0 &&
      opponent.survivalTime.length > 0 &&
      opponent.groundSpeed.length > 0 &&
      opponent.playersLeft.length > 0
    );
  });
}

function surfaceVisibilityPresent(ticks: TickSnapshot[]): boolean {
  return ticks.some(
    (tick) => Boolean(tick.risingGround.visibilityDesktop) && Boolean(tick.risingGround.visibilityMobile),
  );
}

function accessibilitySmokePresent(ticks: TickSnapshot[]): boolean {
  return ticks.some(
    (tick) => tick.accessibility.acceptanceChecksCount > 0 && Boolean(tick.accessibility.hudAnnouncement),
  );
}

await main();
