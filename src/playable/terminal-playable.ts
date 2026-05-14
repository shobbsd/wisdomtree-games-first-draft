import type { RecordMatchResultOutput, LeaderboardRecord } from "../leaderboard/leaderboard-service.js";
import { createBaselineRuntime } from "../index.js";
import type { PlayerSnapshot } from "../types.js";
import { chooseBotThrust, shouldCompleteRound } from "./runtime-helpers.js";

const ROOM_ID = `play-room-${Date.now().toString(36)}`;
const HUMAN_PLAYER_ID = "you";
const BOT_PLAYER_ID = "bot";
const TICK_MS = parsePositiveInt(process.env.PLAYABLE_TICK_MS, 250);
const MAX_TICKS = parsePositiveInt(process.env.PLAYABLE_MAX_TICKS, 160);

interface Controls {
  quitRequested: boolean;
  autoPilot: boolean;
  consumeIntent(): number;
  dispose(): void;
}

interface HudProjection {
  byPlayerId?: Record<string, { score?: { value?: number }; rank?: { value?: string } }>;
}

interface ProvisionalStandingRow {
  rank: number;
  playerId: string;
  score: number;
  height: number;
  eliminated: boolean;
}

const runtime = createBaselineRuntime({ durableStateFilePath: null });
const controls = setupControls();
const sequenceByPlayer = new Map<string, number>([
  [HUMAN_PLAYER_ID, 0],
  [BOT_PLAYER_ID, 0],
]);

let nowMs = Date.now();
let ticks = 0;

process.on("SIGINT", () => {
  controls.dispose();
  process.exit(0);
});

try {
  initializeRoom();
  await runRound();
} finally {
  controls.dispose();
}

function initializeRoom(): void {
  runtime.sessions.createRoom({
    sessionId: ROOM_ID,
    nowMs,
    reconnectTokenSecret: `play:${ROOM_ID}`,
  });
  runtime.sessions.joinRoom(ROOM_ID, HUMAN_PLAYER_ID, { nowMs: nowMs + 1, spawnHeight: 4.7 });
  runtime.sessions.joinRoom(ROOM_ID, BOT_PLAYER_ID, { nowMs: nowMs + 2, spawnHeight: 4.9 });
  runtime.sessions.setPlayerReady(ROOM_ID, HUMAN_PLAYER_ID, true, nowMs + 3);
  runtime.sessions.setPlayerReady(ROOM_ID, BOT_PLAYER_ID, true, nowMs + 4);
}

async function runRound(): Promise<void> {
  while (true) {
    const flowState = runtime.sessions.getFlowState(ROOM_ID);
    const humanPlayer = findPlayer(flowState.players, HUMAN_PLAYER_ID);
    const botPlayer = findPlayer(flowState.players, BOT_PLAYER_ID);

    const humanThrust = controls.autoPilot
      ? chooseBotThrust(humanPlayer, flowState.world.groundHeight)
      : controls.consumeIntent();
    const botThrust = chooseBotThrust(botPlayer, flowState.world.groundHeight);

    submitInput(HUMAN_PLAYER_ID, humanThrust);
    submitInput(BOT_PLAYER_ID, botThrust);

    ticks += 1;
    nowMs += TICK_MS;
    runtime.sessions.advanceRoom(ROOM_ID, TICK_MS, nowMs);

    const advancedFlowState = runtime.sessions.getFlowState(ROOM_ID);
    renderFrame(advancedFlowState, humanThrust, botThrust);

    if (controls.quitRequested || shouldCompleteRound(advancedFlowState.players, ticks, MAX_TICKS)) {
      break;
    }

    await sleep(TICK_MS);
  }

  const result = runtime.sessions.completeRoom(ROOM_ID, {
    recordedAt: nowMs + 1,
  });
  renderFinal(result, runtime.leaderboard.getStandings(10));
}

function submitInput(playerId: string, thrust: number): void {
  const nextSequence = (sequenceByPlayer.get(playerId) ?? 0) + 1;
  sequenceByPlayer.set(playerId, nextSequence);
  runtime.sessions.submitInput(
    ROOM_ID,
    playerId,
    {
      sequence: nextSequence,
      thrust,
    },
    nowMs,
  );
}

function renderFrame(flowState: ReturnType<typeof runtime.sessions.getFlowState>, humanThrust: number, botThrust: number): void {
  const standings = buildProvisionalStandings(flowState);
  process.stdout.write("\u001bc");
  process.stdout.write("Multiplayer Rising Ground - Playable Loop\n");
  process.stdout.write(`Room: ${ROOM_ID}\n`);
  if (controls.autoPilot) {
    process.stdout.write("Controls: auto (set PLAYABLE_AUTO=0 + TTY for manual)\n");
  } else {
    process.stdout.write("Controls: [space/w]=thrust up  [s]=drop  [x]=neutral  [a]=toggle auto  [q]=quit\n");
  }
  process.stdout.write(
    `Tick ${flowState.world.tick} / ${MAX_TICKS}  Ground ${flowState.world.groundHeight.toFixed(2)}  Speed x${(
      flowState.world.groundRiseSpeed / 0.5
    ).toFixed(2)}\n`,
  );
  process.stdout.write(`Intent: ${HUMAN_PLAYER_ID}=${humanThrust.toFixed(2)}  ${BOT_PLAYER_ID}=${botThrust.toFixed(2)}\n`);
  process.stdout.write("\nLive Standings\n");
  for (const row of standings) {
    const status = row.eliminated ? "ELIM" : "LIVE";
    process.stdout.write(
      `${String(row.rank).padStart(2, " ")}. ${row.playerId.padEnd(8, " ")} score=${String(row.score).padStart(
        4,
        " ",
      )}  height=${row.height.toFixed(2).padStart(6, " ")}  ${status}\n`,
    );
  }
}

function renderFinal(result: RecordMatchResultOutput, globalStandings: LeaderboardRecord[]): void {
  process.stdout.write("\nRound Complete\n");
  for (const row of result.standings) {
    process.stdout.write(
      `${String(row.rank).padStart(2, " ")}. ${row.playerId.padEnd(8, " ")} score=${String(row.score).padStart(
        4,
        " ",
      )} token=${row.placementToken}\n`,
    );
  }

  process.stdout.write("\nGlobal Leaderboard\n");
  for (const row of globalStandings) {
    process.stdout.write(
      `${String(row.rank).padStart(2, " ")}. ${row.playerId.padEnd(8, " ")} score=${String(row.score).padStart(
        4,
        " ",
      )} updated=${new Date(row.updatedAt).toISOString()}\n`,
    );
  }
}

function buildProvisionalStandings(
  flowState: ReturnType<typeof runtime.sessions.getFlowState>,
): ProvisionalStandingRow[] {
  const hudByPlayer = (flowState.hud as HudProjection).byPlayerId ?? {};

  return flowState.players
    .map((player) => {
      const score = hudByPlayer[player.playerId]?.score?.value ?? 0;
      return {
        playerId: player.playerId,
        score,
        height: player.height,
        eliminated: player.isEliminated,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.playerId.localeCompare(right.playerId);
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function findPlayer(players: PlayerSnapshot[], playerId: string): PlayerSnapshot | undefined {
  return players.find((player) => player.playerId === playerId);
}

function setupControls(): Controls {
  const forcedAuto = process.env.PLAYABLE_AUTO !== "0";
  const canUseRawInput = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  let quitRequested = false;
  let autoPilot = forcedAuto || !canUseRawInput;
  let intent = 0;

  if (!autoPilot && canUseRawInput) {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk: string) => {
      for (const key of chunk) {
        if (key === "\u0003" || key === "q") {
          quitRequested = true;
          continue;
        }
        if (key === "a") {
          autoPilot = !autoPilot;
          continue;
        }
        if (autoPilot) {
          continue;
        }
        if (key === " " || key.toLowerCase() === "w") {
          intent = 1;
        } else if (key.toLowerCase() === "s") {
          intent = -0.5;
        } else if (key.toLowerCase() === "x") {
          intent = 0;
        }
      }
    });
  }

  return {
    get quitRequested() {
      return quitRequested;
    },
    get autoPilot() {
      return autoPilot;
    },
    consumeIntent() {
      const current = intent;
      intent = 0;
      return current;
    },
    dispose() {
      if (canUseRawInput && process.stdin.isTTY) {
        process.stdin.setRawMode?.(false);
      }
      process.stdin.pause();
    },
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
