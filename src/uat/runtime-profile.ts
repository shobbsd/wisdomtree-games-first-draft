import { resolve } from "node:path";

export interface UatSeedPlayerProfile {
  playerId: string;
  spawnHeight: number;
  thrust: number;
}

export interface UatSeedRoundProfile {
  sessionId: string;
  createdAtMs: number;
  recordedAtMs: number;
  players: ReadonlyArray<UatSeedPlayerProfile>;
  advanceDeltasMs: ReadonlyArray<number>;
}

export const UAT_DETERMINISTIC_SEED_ROUNDS: ReadonlyArray<UatSeedRoundProfile> = [
  {
    sessionId: "uat-round-1",
    createdAtMs: 1_000,
    recordedAtMs: 3_200,
    players: [
      { playerId: "pilot-alpha", spawnHeight: 6.2, thrust: 0.3 },
      { playerId: "pilot-beta", spawnHeight: 5.7, thrust: 0.18 },
      { playerId: "pilot-charlie", spawnHeight: 5.1, thrust: 0.08 },
    ],
    advanceDeltasMs: [500, 500, 600, 600],
  },
  {
    sessionId: "uat-round-2",
    createdAtMs: 10_000,
    recordedAtMs: 12_400,
    players: [
      { playerId: "pilot-delta", spawnHeight: 6.6, thrust: 0.24 },
      { playerId: "pilot-echo", spawnHeight: 5.9, thrust: 0.12 },
      { playerId: "pilot-foxtrot", spawnHeight: 5.0, thrust: 0.03 },
    ],
    advanceDeltasMs: [800, 800, 800],
  },
];

export interface UatRuntimeProfile {
  host: string;
  port: number;
  authTokenSecret: string;
  authTokenTtlMs: number;
  runtimeDir: string;
  durableStateFilePath: string;
  pidFilePath: string;
  logFilePath: string;
  statusFilePath: string;
  seedSummaryFilePath: string;
  healthUrl: string;
}

export function resolveUatRuntimeProfile(env: NodeJS.ProcessEnv = process.env): UatRuntimeProfile {
  const host = (env.UAT_HTTP_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = parsePositiveInteger(env.UAT_HTTP_PORT ?? env.PORT, 4310);
  const authTokenSecret = env.UAT_AUTH_TOKEN_SECRET ?? "uat-local-auth-secret";
  const authTokenTtlMs = parsePositiveInteger(env.UAT_AUTH_TOKEN_TTL_MS, 60 * 60 * 1_000);
  const runtimeDir = resolve(env.UAT_RUNTIME_DIR ?? resolve(process.cwd(), ".runtime", "uat"));
  const durableStateFilePath = resolve(
    env.UAT_DURABLE_STATE_FILE ?? resolve(runtimeDir, "durable-state.json"),
  );
  const pidFilePath = resolve(env.UAT_PID_FILE ?? resolve(runtimeDir, "server.pid"));
  const logFilePath = resolve(env.UAT_LOG_FILE ?? resolve(runtimeDir, "server.log"));
  const statusFilePath = resolve(env.UAT_STATUS_FILE ?? resolve(runtimeDir, "server-status.json"));
  const seedSummaryFilePath = resolve(env.UAT_SEED_SUMMARY_FILE ?? resolve(runtimeDir, "seed-summary.json"));
  const healthUrl = `http://${host}:${port}/health`;

  return {
    host,
    port,
    authTokenSecret,
    authTokenTtlMs,
    runtimeDir,
    durableStateFilePath,
    pidFilePath,
    logFilePath,
    statusFilePath,
    seedSummaryFilePath,
    healthUrl,
  };
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
