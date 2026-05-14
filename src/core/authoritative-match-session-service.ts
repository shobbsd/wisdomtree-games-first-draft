import { LeaderboardService } from "../leaderboard/leaderboard-service.js";
import { InMemoryEventSink } from "../telemetry/event-sink.js";
import { SessionManager, type RoomFlowState } from "./session-manager.js";
import {
  INTEGRITY_RULE_IDS,
  resolveSessionIntegrityConfig,
  type SessionIntegrityConfig,
} from "./session-integrity.js";

export interface MatchSeedPlayer {
  playerId: string;
  spawnHeight?: number;
}

export interface CreateMatchInput {
  matchId: string;
  nowMs: number;
  players: ReadonlyArray<MatchSeedPlayer>;
}

export interface MatchClientIntent {
  playerId: string;
  sequence: number;
  thrust: number;
}

export interface AuthoritativeMatchSessionServiceOptions {
  sessions: SessionManager;
  tickMs?: number;
  maxTicksPerFlush?: number;
  integrityConfig?: Partial<SessionIntegrityConfig>;
}

export interface MatchEventOrderingKey {
  matchId: string;
  tick: number;
  seqInTick: number;
}

export type MatchEventType =
  | "match.started"
  | "intent.applied"
  | "intent.rejected"
  | "tick.advanced"
  | "snapshot.fanout";

export interface MatchEventLogEntry {
  orderingKey: MatchEventOrderingKey;
  type: MatchEventType;
  occurredAtMs: number;
  payload: Record<string, unknown>;
}

export type SubmitIntentResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "match_not_found"
        | "client_state_not_allowed"
        | "invalid_intent"
        | "stale"
        | "out_of_order"
        | "missing_player"
        | "disconnected"
        | "eliminated"
        | "rate_limited_player"
        | "rate_limited_room"
        | "stale_time_drift";
    };

export interface MatchRuntimeState {
  matchId: string;
  tick: number;
  tickMs: number;
  tickRateHz: number;
  nextTickDueAtMs: number;
  pendingIntents: number;
  eventLogEntries: number;
}

export interface ReplayVerification {
  ok: boolean;
  mismatches: string[];
  finalTick: number;
  finalStateHash: string;
}

interface QueuedIntent extends MatchClientIntent {
  receivedAtMs: number;
}

interface MatchRuntime {
  matchId: string;
  tickMs: number;
  tickRateHz: number;
  tick: number;
  nextTickDueAtMs: number;
  pendingIntents: QueuedIntent[];
  eventLog: MatchEventLogEntry[];
  subscribers: Set<(snapshot: RoomFlowState) => void>;
}

const ALLOWED_INTENT_KEYS = new Set(["playerId", "sequence", "thrust"]);

export class AuthoritativeMatchSessionService {
  private readonly sessions: SessionManager;

  private readonly tickMs: number;

  private readonly maxTicksPerFlush: number;

  private readonly integrityConfig: SessionIntegrityConfig;

  private readonly matches = new Map<string, MatchRuntime>();

  constructor(options: AuthoritativeMatchSessionServiceOptions) {
    this.sessions = options.sessions;
    this.tickMs = normalizeTickMs(options.tickMs ?? 50);
    this.maxTicksPerFlush = Math.max(1, Math.floor(options.maxTicksPerFlush ?? 200));
    this.integrityConfig = resolveSessionIntegrityConfig(options.integrityConfig);
  }

  createMatch(input: CreateMatchInput): void {
    if (this.matches.has(input.matchId)) {
      throw new Error(`Match ${input.matchId} already exists`);
    }
    if (input.players.length === 0) {
      throw new Error("players must contain at least one player");
    }

    const duplicatePlayerId = findDuplicatePlayerId(input.players);
    if (duplicatePlayerId) {
      throw new Error(`Duplicate player id ${duplicatePlayerId}`);
    }

    this.sessions.createRoom({
      sessionId: input.matchId,
      nowMs: input.nowMs,
    });

    const sortedPlayers = [...input.players].sort((left, right) => left.playerId.localeCompare(right.playerId));
    for (const player of sortedPlayers) {
      this.sessions.joinRoom(input.matchId, player.playerId, {
        nowMs: input.nowMs,
        spawnHeight: player.spawnHeight,
      });
    }

    const runtime: MatchRuntime = {
      matchId: input.matchId,
      tickMs: this.tickMs,
      tickRateHz: round(1000 / this.tickMs, 3),
      tick: 0,
      nextTickDueAtMs: input.nowMs + this.tickMs,
      pendingIntents: [],
      eventLog: [],
      subscribers: new Set(),
    };

    this.matches.set(input.matchId, runtime);
    this.appendLog(runtime, "match.started", input.nowMs, {
      tickMs: runtime.tickMs,
      tickRateHz: runtime.tickRateHz,
      players: sortedPlayers.map((player) => ({
        playerId: player.playerId,
        spawnHeight: player.spawnHeight ?? null,
      })),
    });
  }

  submitIntent(matchId: string, intent: MatchClientIntent, receivedAtMs = Date.now()): SubmitIntentResult {
    const runtime = this.matches.get(matchId);
    if (!runtime) {
      return { accepted: false, reason: "match_not_found" };
    }

    if (!isIntentWithoutClientState(intent)) {
      const reason = hasClientAuthorityFields(intent) ? "client_state_not_allowed" : "invalid_intent";
      this.appendLog(runtime, "intent.rejected", receivedAtMs, {
        playerId: safeReadString((intent as Record<string, unknown>)?.playerId),
        sequence: safeReadNumber((intent as Record<string, unknown>)?.sequence),
        thrust: safeReadNumber((intent as Record<string, unknown>)?.thrust),
        receivedAtMs,
        reason,
        accepted: false,
      });
      return { accepted: false, reason };
    }

    runtime.pendingIntents.push({
      ...intent,
      receivedAtMs,
    });

    return { accepted: true };
  }

  flush(matchId: string, nowMs = Date.now()): number {
    const runtime = this.requireRuntime(matchId);

    let ticksProcessed = 0;
    while (nowMs >= runtime.nextTickDueAtMs && ticksProcessed < this.maxTicksPerFlush) {
      this.processTick(runtime, runtime.nextTickDueAtMs);
      runtime.nextTickDueAtMs += runtime.tickMs;
      ticksProcessed += 1;
    }

    return ticksProcessed;
  }

  subscribeSnapshots(matchId: string, handler: (snapshot: RoomFlowState) => void): () => void {
    const runtime = this.requireRuntime(matchId);
    runtime.subscribers.add(handler);

    return () => {
      runtime.subscribers.delete(handler);
    };
  }

  getEventLog(matchId: string): MatchEventLogEntry[] {
    const runtime = this.requireRuntime(matchId);
    return structuredClone(runtime.eventLog);
  }

  getFlowState(matchId: string): RoomFlowState {
    this.requireRuntime(matchId);
    return this.sessions.getFlowState(matchId);
  }

  getMatchState(matchId: string): MatchRuntimeState {
    const runtime = this.requireRuntime(matchId);
    return {
      matchId: runtime.matchId,
      tick: runtime.tick,
      tickMs: runtime.tickMs,
      tickRateHz: runtime.tickRateHz,
      nextTickDueAtMs: runtime.nextTickDueAtMs,
      pendingIntents: runtime.pendingIntents.length,
      eventLogEntries: runtime.eventLog.length,
    };
  }

  private processTick(runtime: MatchRuntime, tickAtMs: number): void {
    runtime.tick += 1;

    const ready: QueuedIntent[] = [];
    const waiting: QueuedIntent[] = [];
    for (const intent of runtime.pendingIntents) {
      if (intent.receivedAtMs <= tickAtMs) {
        ready.push(intent);
      } else {
        waiting.push(intent);
      }
    }
    runtime.pendingIntents = waiting;

    ready.sort((left, right) => {
      if (left.receivedAtMs !== right.receivedAtMs) {
        return left.receivedAtMs - right.receivedAtMs;
      }
      const playerOrder = left.playerId.localeCompare(right.playerId);
      if (playerOrder !== 0) {
        return playerOrder;
      }
      return left.sequence - right.sequence;
    });

    for (const intent of ready) {
      const intentAgeMs = tickAtMs - intent.receivedAtMs;
      if (this.integrityConfig.enforceIntentAge && intentAgeMs > this.integrityConfig.maxIntentAgeMs) {
        this.sessions.recordIntegrityViolation(runtime.matchId, {
          playerId: intent.playerId,
          ruleId: INTEGRITY_RULE_IDS.timeDriftIntentAge,
          category: "time_drift",
          severity: "warn",
          action: "reject_input",
          threshold: this.integrityConfig.maxIntentAgeMs,
          evidence: {
            sequence: intent.sequence,
            thrust: intent.thrust,
            intentAgeMs,
            tickAtMs,
            receivedAtMs: intent.receivedAtMs,
          },
          detectedAt: tickAtMs,
        });
        this.appendLog(runtime, "intent.rejected", tickAtMs, {
          playerId: intent.playerId,
          sequence: intent.sequence,
          thrust: intent.thrust,
          receivedAtMs: intent.receivedAtMs,
          accepted: false,
          reason: "stale_time_drift",
        });
        continue;
      }

      const submission = this.sessions.submitInput(
        runtime.matchId,
        intent.playerId,
        {
          sequence: intent.sequence,
          thrust: intent.thrust,
        },
        intent.receivedAtMs,
      );

      if (submission.accepted) {
        this.appendLog(runtime, "intent.applied", tickAtMs, {
          playerId: intent.playerId,
          sequence: intent.sequence,
          thrust: intent.thrust,
          receivedAtMs: intent.receivedAtMs,
          accepted: true,
        });
      } else {
        this.appendLog(runtime, "intent.rejected", tickAtMs, {
          playerId: intent.playerId,
          sequence: intent.sequence,
          thrust: intent.thrust,
          receivedAtMs: intent.receivedAtMs,
          accepted: false,
          reason: submission.reason,
        });
      }
    }

    this.sessions.advanceRoom(runtime.matchId, runtime.tickMs, tickAtMs);
    const flowState = this.sessions.getFlowState(runtime.matchId);

    this.appendLog(runtime, "tick.advanced", tickAtMs, {
      tick: flowState.world.tick,
      revision: flowState.revision,
      stateHash: flowState.world.stateHash,
    });

    for (const subscriber of runtime.subscribers) {
      subscriber(flowState);
    }

    this.appendLog(runtime, "snapshot.fanout", tickAtMs, {
      tick: flowState.world.tick,
      revision: flowState.revision,
      stateHash: flowState.world.stateHash,
      subscribers: runtime.subscribers.size,
    });
  }

  private appendLog(
    runtime: MatchRuntime,
    type: MatchEventType,
    occurredAtMs: number,
    payload: Record<string, unknown>,
  ): void {
    const currentTick = runtime.tick;
    const seqInTick = runtime.eventLog.filter((entry) => entry.orderingKey.tick === currentTick).length + 1;

    runtime.eventLog.push({
      orderingKey: {
        matchId: runtime.matchId,
        tick: currentTick,
        seqInTick,
      },
      type,
      occurredAtMs,
      payload,
    });
  }

  private requireRuntime(matchId: string): MatchRuntime {
    const runtime = this.matches.get(matchId);
    if (!runtime) {
      throw new Error(`Unknown match ${matchId}`);
    }

    return runtime;
  }
}

export function replayAuthoritativeMatchSessionLog(log: ReadonlyArray<MatchEventLogEntry>): ReplayVerification {
  if (log.length === 0) {
    return {
      ok: false,
      mismatches: ["event log is empty"],
      finalTick: 0,
      finalStateHash: "",
    };
  }

  const startEvent = log.find((entry) => entry.type === "match.started");
  if (!startEvent) {
    return {
      ok: false,
      mismatches: ["missing match.started event"],
      finalTick: 0,
      finalStateHash: "",
    };
  }

  const matchId = startEvent.orderingKey.matchId;
  const tickMs = safeReadNumber(startEvent.payload.tickMs);
  if (!Number.isFinite(tickMs) || tickMs <= 0) {
    return {
      ok: false,
      mismatches: ["match.started payload missing valid tickMs"],
      finalTick: 0,
      finalStateHash: "",
    };
  }

  const players = parseSeedPlayers(startEvent.payload.players);
  if (players.length === 0) {
    return {
      ok: false,
      mismatches: ["match.started payload missing valid players"],
      finalTick: 0,
      finalStateHash: "",
    };
  }

  const events = new InMemoryEventSink();
  const leaderboard = new LeaderboardService({ eventSink: events });
  const sessions = new SessionManager({ eventSink: events, leaderboard });
  const service = new AuthoritativeMatchSessionService({ sessions, tickMs });

  service.createMatch({
    matchId,
    nowMs: startEvent.occurredAtMs,
    players,
  });

  const mismatches: string[] = [];
  const ticks = [...new Set(log.map((entry) => entry.orderingKey.tick).filter((tick) => tick > 0))].sort((a, b) => a - b);

  for (const tick of ticks) {
    const tickEntries = log
      .filter((entry) => entry.orderingKey.tick === tick)
      .sort((left, right) => left.orderingKey.seqInTick - right.orderingKey.seqInTick);

    for (const entry of tickEntries) {
      if (entry.type !== "intent.applied" && entry.type !== "intent.rejected") {
        continue;
      }

      const replayResult = service.submitIntent(
        matchId,
        {
          playerId: safeReadString(entry.payload.playerId),
          sequence: safeReadNumber(entry.payload.sequence),
          thrust: safeReadNumber(entry.payload.thrust),
        },
        safeReadNumber(entry.payload.receivedAtMs),
      );
      const expectedAccepted = Boolean(entry.payload.accepted);
      if (replayResult.accepted !== expectedAccepted) {
        mismatches.push(
          `tick ${tick} seq ${entry.orderingKey.seqInTick}: accepted mismatch expected ${expectedAccepted} got ${replayResult.accepted}`,
        );
      }
    }

    const tickAdvanced = tickEntries.find((entry) => entry.type === "tick.advanced");
    if (!tickAdvanced) {
      mismatches.push(`tick ${tick}: missing tick.advanced event`);
      continue;
    }

    const advanced = service.flush(matchId, tickAdvanced.occurredAtMs);
    if (advanced !== 1) {
      mismatches.push(`tick ${tick}: expected flush to advance 1 tick, got ${advanced}`);
    }

    const state = service.getFlowState(matchId);
    const expectedTick = safeReadNumber(tickAdvanced.payload.tick);
    const expectedStateHash = safeReadString(tickAdvanced.payload.stateHash);

    if (state.world.tick !== expectedTick) {
      mismatches.push(`tick ${tick}: expected world.tick ${expectedTick}, got ${state.world.tick}`);
    }
    if (state.world.stateHash !== expectedStateHash) {
      mismatches.push(`tick ${tick}: expected stateHash ${expectedStateHash}, got ${state.world.stateHash}`);
    }
  }

  const finalState = service.getFlowState(matchId);
  return {
    ok: mismatches.length === 0,
    mismatches,
    finalTick: finalState.world.tick,
    finalStateHash: finalState.world.stateHash,
  };
}

function parseSeedPlayers(raw: unknown): MatchSeedPlayer[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const players: MatchSeedPlayer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.playerId !== "string" || candidate.playerId.length === 0) {
      continue;
    }

    players.push({
      playerId: candidate.playerId,
      spawnHeight: typeof candidate.spawnHeight === "number" ? candidate.spawnHeight : undefined,
    });
  }

  return players;
}

function findDuplicatePlayerId(players: ReadonlyArray<MatchSeedPlayer>): string | null {
  const seen = new Set<string>();
  for (const player of players) {
    if (seen.has(player.playerId)) {
      return player.playerId;
    }
    seen.add(player.playerId);
  }

  return null;
}

function normalizeTickMs(rawTickMs: number): number {
  if (!Number.isFinite(rawTickMs) || rawTickMs <= 0) {
    throw new Error("tickMs must be positive finite number");
  }

  return Math.max(1, Math.floor(rawTickMs));
}

function isIntentWithoutClientState(intent: MatchClientIntent): intent is MatchClientIntent {
  if (!intent || typeof intent !== "object") {
    return false;
  }

  const candidate = intent as unknown as Record<string, unknown>;
  if (hasClientAuthorityFields(candidate)) {
    return false;
  }

  return (
    typeof candidate.playerId === "string" &&
    candidate.playerId.length > 0 &&
    Number.isInteger(candidate.sequence) &&
    typeof candidate.thrust === "number" &&
    Number.isFinite(candidate.thrust)
  );
}

function hasClientAuthorityFields(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).some((key) => !ALLOWED_INTENT_KEYS.has(key));
}

function safeReadString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeReadNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
