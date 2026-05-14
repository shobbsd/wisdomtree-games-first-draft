import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createBaselineRuntime } from "../index.js";
import { type TelemetryEvent } from "../telemetry/event-sink.js";
import { WIS135_RISING_GROUND_EVENT_NAMES } from "../ux/wis135-rising-ground-contract.js";
import { resolveUatRuntimeProfile } from "./runtime-profile.js";

type LifecycleLabel = "countdown" | "warning" | "critical" | "elimination" | "results" | "reconnect" | "cta route";

export interface Wis193LifecycleRecord {
  stateOrderIndex: number;
  lifecycle: LifecycleLabel;
  timestampMs: number;
  sessionId: string;
  details: Record<string, unknown>;
}

export interface Wis193ReconnectOutcome {
  sessionId: string;
  playerId: string;
  outcome: "success" | "timeout";
  timestampMs: number;
  reason: "connected" | "token_expired";
}

export interface Wis193CtaRouteOutcome {
  sessionId: string;
  action: "play_again" | "back_to_lobby";
  destination: "pre_match.ready_check" | "pre_match.lobby_ready";
  destinationReached: true;
  timestampMs: number;
}

export interface Wis193TelemetryEvidenceBundle {
  issue: "WIS-193";
  generatedAt: string;
  schemaVersion: "1.0.0";
  captureCommand: string;
  artifactPath: string;
  orderedLifecycleRecords: Wis193LifecycleRecord[];
  reconnectOutcomes: Wis193ReconnectOutcome[];
  ctaRouteOutcomes: Wis193CtaRouteOutcome[];
}

export interface CaptureWis193TelemetryEvidenceOptions {
  outputFilePath?: string;
  generatedAt?: string;
}

interface LifecycleRecordDraft {
  lifecycle: LifecycleLabel;
  timestampMs: number;
  sessionId: string;
  details: Record<string, unknown>;
}

const DEFAULT_OUTPUT_FILE_NAME = "WIS-193-telemetry-evidence.json";
const CAPTURE_COMMAND = "npm run --silent uat:evidence:wis193";

export function captureWis193TelemetryEvidence(
  options: CaptureWis193TelemetryEvidenceOptions = {},
): Wis193TelemetryEvidenceBundle {
  const profile = resolveUatRuntimeProfile();
  const artifactPath = resolve(options.outputFilePath ?? join(profile.runtimeDir, DEFAULT_OUTPUT_FILE_NAME));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runtime = createBaselineRuntime({ durableStateFilePath: null });

  const lifecycleDrafts: LifecycleRecordDraft[] = [];

  captureCountdownLifecycle(runtime, lifecycleDrafts);
  captureRisingGroundLifecycle(runtime, lifecycleDrafts);
  captureResultsLifecycle(runtime, lifecycleDrafts);
  const reconnectOutcomes = captureReconnectOutcomes(runtime, lifecycleDrafts);
  const ctaRouteOutcomes = captureCtaRouteOutcomes(runtime, lifecycleDrafts);

  const orderedLifecycleRecords = lifecycleDrafts
    .slice()
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      if (left.sessionId !== right.sessionId) {
        return left.sessionId.localeCompare(right.sessionId);
      }
      return left.lifecycle.localeCompare(right.lifecycle);
    })
    .map((record, index) => ({
      stateOrderIndex: index + 1,
      lifecycle: record.lifecycle,
      timestampMs: record.timestampMs,
      sessionId: record.sessionId,
      details: record.details,
    }));

  const bundle: Wis193TelemetryEvidenceBundle = {
    issue: "WIS-193",
    generatedAt,
    schemaVersion: "1.0.0",
    captureCommand: CAPTURE_COMMAND,
    artifactPath,
    orderedLifecycleRecords,
    reconnectOutcomes,
    ctaRouteOutcomes,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  return bundle;
}

function captureCountdownLifecycle(
  runtime: ReturnType<typeof createBaselineRuntime>,
  lifecycleDrafts: LifecycleRecordDraft[],
): void {
  const sessionId = "wis193-countdown";

  runtime.sessions.createRoom({ sessionId, nowMs: 0 });
  runtime.sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 8 });
  runtime.sessions.joinRoom(sessionId, "beta", { nowMs: 20, spawnHeight: 8 });
  runtime.sessions.setPlayerReady(sessionId, "alpha", true, 30);
  runtime.sessions.setPlayerReady(sessionId, "beta", true, 40);

  const countdownState = runtime.sessions.getFlowState(sessionId);
  lifecycleDrafts.push({
    lifecycle: "countdown",
    timestampMs: countdownState.updatedAt,
    sessionId,
    details: {
      uxStateId: countdownState.uxState.id,
      reason: countdownState.uxState.reason,
    },
  });
}

function captureRisingGroundLifecycle(
  runtime: ReturnType<typeof createBaselineRuntime>,
  lifecycleDrafts: LifecycleRecordDraft[],
): void {
  const sessionId = "wis193-rising-ground";
  const baseMs = 10_000;
  const eventsStart = runtime.events.list().length;

  runtime.sessions.createRoom({ sessionId, nowMs: baseMs });
  runtime.sessions.joinRoom(sessionId, "alpha", { nowMs: baseMs + 10, spawnHeight: 6 });
  runtime.sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 1 }, baseMs + 20);
  runtime.sessions.advanceRoom(sessionId, 100, baseMs + 100);
  runtime.sessions.advanceRoom(sessionId, 1_600, baseMs + 1_700);
  runtime.sessions.advanceRoom(sessionId, 1_900, baseMs + 3_600);
  runtime.sessions.submitInput(sessionId, "alpha", { sequence: 2, thrust: -1 }, baseMs + 3_610);
  runtime.sessions.advanceRoom(sessionId, 3_000, baseMs + 6_600);

  const events = runtime.events.list().slice(eventsStart);
  const warning = requireEvent(events, WIS135_RISING_GROUND_EVENT_NAMES.warningEnter, sessionId);
  const critical = requireEvent(events, WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter, sessionId);
  const elimination = requireEvent(events, WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered, sessionId);

  lifecycleDrafts.push({
    lifecycle: "warning",
    timestampMs: getNumberPayloadField(warning, "serverTs"),
    sessionId,
    details: {
      eventType: warning.type,
      dangerTier: getStringPayloadField(warning, "dangerTier"),
    },
  });
  lifecycleDrafts.push({
    lifecycle: "critical",
    timestampMs: getNumberPayloadField(critical, "serverTs"),
    sessionId,
    details: {
      eventType: critical.type,
      dangerTier: getStringPayloadField(critical, "dangerTier"),
    },
  });
  lifecycleDrafts.push({
    lifecycle: "elimination",
    timestampMs: getNumberPayloadField(elimination, "serverTs"),
    sessionId,
    details: {
      eventType: elimination.type,
      cause: getStringPayloadField(elimination, "cause"),
    },
  });
}

function captureResultsLifecycle(
  runtime: ReturnType<typeof createBaselineRuntime>,
  lifecycleDrafts: LifecycleRecordDraft[],
): void {
  const sessionId = "wis193-results";
  const baseMs = 20_000;
  const eventsStart = runtime.events.list().length;

  runtime.sessions.createRoom({ sessionId, nowMs: baseMs });
  runtime.sessions.joinRoom(sessionId, "alpha", { nowMs: baseMs + 10, spawnHeight: 9 });
  runtime.sessions.joinRoom(sessionId, "beta", { nowMs: baseMs + 20, spawnHeight: 8.5 });
  runtime.sessions.advanceRoom(sessionId, 100, baseMs + 100);
  runtime.sessions.completeRoom(sessionId, { recordedAt: baseMs + 300 });

  const events = runtime.events.list().slice(eventsStart);
  const completed = requireEvent(events, "session.lifecycle.completed", sessionId);
  lifecycleDrafts.push({
    lifecycle: "results",
    timestampMs: getNumberPayloadField(completed, "recordedAt"),
    sessionId,
    details: {
      eventType: completed.type,
      players: getNumberPayloadField(completed, "players"),
    },
  });
}

function captureReconnectOutcomes(
  runtime: ReturnType<typeof createBaselineRuntime>,
  lifecycleDrafts: LifecycleRecordDraft[],
): Wis193ReconnectOutcome[] {
  const sessionId = "wis193-reconnect";
  const baseMs = 25_000;

  runtime.sessions.createRoom({ sessionId, nowMs: baseMs, reconnectGraceMs: 1_000 });
  runtime.sessions.joinRoom(sessionId, "alpha", { nowMs: baseMs + 10, spawnHeight: 8 });
  runtime.sessions.joinRoom(sessionId, "beta", { nowMs: baseMs + 20, spawnHeight: 8 });
  runtime.sessions.advanceRoom(sessionId, 100, baseMs + 100);

  const firstDisconnect = runtime.sessions.disconnectPlayer(sessionId, "alpha", { nowMs: baseMs + 200 });
  const reconnectSuccess = runtime.sessions.reconnectPlayer(sessionId, firstDisconnect.resumeToken, {
    nowMs: baseMs + 300,
  });

  const secondDisconnect = runtime.sessions.disconnectPlayer(sessionId, "alpha", { nowMs: baseMs + 400 });
  runtime.sessions.advanceRoom(sessionId, 100, baseMs + 1_450);
  const reconnectTimeout = runtime.sessions.reconnectPlayer(sessionId, secondDisconnect.resumeToken, {
    nowMs: baseMs + 1_460,
  });

  if (!reconnectSuccess.connected || reconnectSuccess.playerId !== "alpha") {
    throw new Error("Expected reconnect success outcome for alpha");
  }
  if (reconnectTimeout.connected || reconnectTimeout.reason !== "token_expired" || reconnectTimeout.playerId !== "alpha") {
    throw new Error("Expected reconnect timeout outcome for alpha");
  }

  const outcomes: Wis193ReconnectOutcome[] = [
    {
      sessionId,
      playerId: "alpha",
      outcome: "success",
      timestampMs: baseMs + 300,
      reason: "connected",
    },
    {
      sessionId,
      playerId: "alpha",
      outcome: "timeout",
      timestampMs: baseMs + 1_460,
      reason: "token_expired",
    },
  ];

  for (const outcome of outcomes) {
    lifecycleDrafts.push({
      lifecycle: "reconnect",
      timestampMs: outcome.timestampMs,
      sessionId: outcome.sessionId,
      details: {
        playerId: outcome.playerId,
        outcome: outcome.outcome,
        reason: outcome.reason,
      },
    });
  }

  return outcomes;
}

function captureCtaRouteOutcomes(
  runtime: ReturnType<typeof createBaselineRuntime>,
  lifecycleDrafts: LifecycleRecordDraft[],
): Wis193CtaRouteOutcome[] {
  const playAgain = capturePostMatchRoute(runtime, {
    sessionId: "wis193-cta-play-again",
    baseMs: 30_000,
    actionId: "REPLAY_MATCH",
    action: "play_again",
    destination: "pre_match.ready_check",
  });
  const backToLobby = capturePostMatchRoute(runtime, {
    sessionId: "wis193-cta-back-to-lobby",
    baseMs: 35_000,
    actionId: "BACK_TO_LOBBY",
    action: "back_to_lobby",
    destination: "pre_match.lobby_ready",
  });

  const outcomes = [playAgain, backToLobby];
  for (const outcome of outcomes) {
    lifecycleDrafts.push({
      lifecycle: "cta route",
      timestampMs: outcome.timestampMs,
      sessionId: outcome.sessionId,
      details: {
        action: outcome.action,
        destination: outcome.destination,
        destinationReached: outcome.destinationReached,
      },
    });
  }

  return outcomes;
}

function capturePostMatchRoute(
  runtime: ReturnType<typeof createBaselineRuntime>,
  input: {
    sessionId: string;
    baseMs: number;
    actionId: "REPLAY_MATCH" | "BACK_TO_LOBBY";
    action: "play_again" | "back_to_lobby";
    destination: "pre_match.ready_check" | "pre_match.lobby_ready";
  },
): Wis193CtaRouteOutcome {
  const { sessionId, baseMs, actionId, action, destination } = input;
  const selectedAtMs = baseMs + 320;

  runtime.sessions.createRoom({ sessionId, nowMs: baseMs });
  runtime.sessions.joinRoom(sessionId, "alpha", { nowMs: baseMs + 10, spawnHeight: 9 });
  runtime.sessions.joinRoom(sessionId, "beta", { nowMs: baseMs + 20, spawnHeight: 8.5 });
  runtime.sessions.advanceRoom(sessionId, 100, baseMs + 100);
  runtime.sessions.completeRoom(sessionId, { recordedAt: baseMs + 300 });

  const selected = runtime.sessions.selectPostMatchAction(sessionId, actionId, selectedAtMs);
  if (selected.routeTarget !== destination) {
    throw new Error(`Expected ${action} destination ${destination}, got ${selected.routeTarget}`);
  }

  return {
    sessionId,
    action,
    destination,
    destinationReached: true,
    timestampMs: selected.selectedAtMs,
  };
}

function requireEvent(
  events: TelemetryEvent[],
  type: string,
  sessionId: string,
): TelemetryEvent<Record<string, unknown>> {
  const match = events.find((event) => {
    if (event.type !== type || typeof event.payload !== "object" || event.payload === null) {
      return false;
    }

    const payload = event.payload as Record<string, unknown>;
    return payload.sessionId === sessionId || payload.matchId === sessionId;
  });
  if (!match) {
    throw new Error(`Missing telemetry event ${type} for ${sessionId}`);
  }

  return match as TelemetryEvent<Record<string, unknown>>;
}

function getNumberPayloadField(event: TelemetryEvent<Record<string, unknown>>, key: string): number {
  const value = event.payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric payload field ${key} on event ${event.type}`);
  }
  return value;
}

function getStringPayloadField(event: TelemetryEvent<Record<string, unknown>>, key: string): string {
  const value = event.payload[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string payload field ${key} on event ${event.type}`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bundle = captureWis193TelemetryEvidence();
  process.stdout.write(
    `${JSON.stringify(
      {
        event: "uat_telemetry_evidence_captured",
        issue: bundle.issue,
        artifactPath: bundle.artifactPath,
        captureCommand: bundle.captureCommand,
        lifecycleRecordCount: bundle.orderedLifecycleRecords.length,
      },
      null,
      2,
    )}\n`,
  );
}
