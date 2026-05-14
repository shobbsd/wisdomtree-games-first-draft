import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { PlayerInput, PlayerSnapshot, SessionSnapshot } from "../types.js";
import {
  INTEGRITY_RULE_IDS,
  resolveSessionIntegrityConfig,
  type RuntimeIntegrityViolation,
  type SessionIntegrityConfig,
} from "./session-integrity.js";

interface MultiplayerSessionOptions {
  sessionId: string;
  maxPlayers?: number;
  groundStartSpeed?: number;
  groundAccelerationPerSecond?: number;
  groundMaxSpeed?: number;
  reconnectGraceMs?: number;
  reconnectTokenSecret?: string;
  reconnectTokenReplayRetentionMs?: number;
  gravityPerSecond?: number;
  thrustForcePerSecond?: number;
  playerInputRateLimitPerSecond?: number;
  roomInputRateLimitPerSecond?: number;
  inputRateWindowMs?: number;
  integrityConfig?: Partial<SessionIntegrityConfig>;
}

interface JoinPlayerOptions {
  spawnHeight?: number;
  nowMs: number;
}

interface PlayerState {
  playerId: string;
  height: number;
  velocity: number;
  thrust: number;
  connected: boolean;
  isEliminated: boolean;
  eliminationReason: "ground" | "disconnected" | null;
  lastInputSequence: number;
  survivalMs: number;
  disconnectExpiresAtMs: number | null;
  resumeToken: string | null;
  resumeTokenId: string | null;
}

export interface DisconnectResult {
  playerId: string;
  resumeToken: string;
  expiresAtMs: number;
}

export interface ReconnectResult {
  connected: boolean;
  playerId?: string;
  reason?: "unknown_token" | "token_expired" | "token_replayed";
}

export interface ExpiredReconnectRecord {
  playerId: string;
  expiredAtMs: number;
}

interface ReconnectTokenPayload {
  v: 1;
  sid: string;
  pid: string;
  jti: string;
  exp: number;
}

interface ReconnectTokenRecord {
  playerId: string;
  expiresAtMs: number;
  state: "active" | "consumed" | "expired";
}

interface InputRateWindow {
  windowStartMs: number;
  count: number;
}

export type SubmitInputResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "impossible_input"
        | "stale"
        | "out_of_order"
        | "missing_player"
        | "disconnected"
        | "eliminated"
        | "rate_limited_player"
        | "rate_limited_room";
    };

export class MultiplayerSession {
  readonly sessionId: string;

  private readonly maxPlayers: number | null;

  private readonly reconnectGraceMs: number;

  private readonly groundAccelerationPerSecond: number;

  private readonly groundMaxSpeed: number;

  private readonly gravityPerSecond: number;

  private readonly thrustForcePerSecond: number;

  private readonly reconnectTokenSecret: Buffer;

  private readonly reconnectTokenReplayRetentionMs: number;

  private readonly inputRateWindowMs: number;

  private readonly playerInputRateLimitPerWindow: number;

  private readonly roomInputRateLimitPerWindow: number;

  private readonly integrityConfig: SessionIntegrityConfig;

  private readonly players = new Map<string, PlayerState>();

  private readonly reconnectTokensById = new Map<string, ReconnectTokenRecord>();

  private readonly playerInputWindows = new Map<string, InputRateWindow>();

  private readonly roomInputWindow: InputRateWindow = {
    windowStartMs: 0,
    count: 0,
  };

  private tickCount = 0;

  private groundHeight = 0;

  private groundRiseSpeed: number;

  private readonly runtimeIntegrityViolations: RuntimeIntegrityViolation[] = [];

  constructor(options: MultiplayerSessionOptions) {
    this.sessionId = options.sessionId;
    if (options.maxPlayers !== undefined) {
      if (!Number.isInteger(options.maxPlayers) || options.maxPlayers < 1) {
        throw new Error("maxPlayers must be positive integer");
      }
      this.maxPlayers = options.maxPlayers;
    } else {
      this.maxPlayers = null;
    }
    this.reconnectGraceMs = options.reconnectGraceMs ?? 30_000;
    this.reconnectTokenReplayRetentionMs = options.reconnectTokenReplayRetentionMs ?? 60_000;

    const reconnectTokenSeed = options.reconnectTokenSecret ?? randomBytes(32).toString("hex");
    this.reconnectTokenSecret = createHash("sha256").update(reconnectTokenSeed).digest();

    this.groundRiseSpeed = options.groundStartSpeed ?? 0.5;
    this.groundAccelerationPerSecond = options.groundAccelerationPerSecond ?? 0.12;
    this.groundMaxSpeed = options.groundMaxSpeed ?? 4.5;
    this.gravityPerSecond = options.gravityPerSecond ?? 1.5;
    this.thrustForcePerSecond = options.thrustForcePerSecond ?? 3;

    this.inputRateWindowMs = Math.max(100, Math.floor(options.inputRateWindowMs ?? 1_000));
    this.playerInputRateLimitPerWindow = toPerWindowLimit(
      options.playerInputRateLimitPerSecond ?? 20,
      this.inputRateWindowMs,
    );
    this.roomInputRateLimitPerWindow = toPerWindowLimit(
      options.roomInputRateLimitPerSecond ?? 120,
      this.inputRateWindowMs,
    );
    this.integrityConfig = resolveSessionIntegrityConfig(options.integrityConfig);
  }

  joinPlayer(playerId: string, options: JoinPlayerOptions): PlayerSnapshot {
    if (this.players.has(playerId)) {
      throw new Error(`Player ${playerId} already joined`);
    }
    if (this.maxPlayers !== null && this.players.size >= this.maxPlayers) {
      throw new Error(`Session ${this.sessionId} is full`);
    }

    const state: PlayerState = {
      playerId,
      height: options.spawnHeight ?? 5,
      velocity: 0,
      thrust: 0,
      connected: true,
      isEliminated: false,
      eliminationReason: null,
      lastInputSequence: 0,
      survivalMs: 0,
      disconnectExpiresAtMs: null,
      resumeToken: null,
      resumeTokenId: null,
    };

    this.players.set(playerId, state);

    return this.toPlayerSnapshot(state);
  }

  disconnectPlayer(playerId: string, nowMs: number): DisconnectResult {
    const player = this.requirePlayer(playerId);
    this.pruneReconnectTokenRecords(nowMs);

    if (player.isEliminated) {
      throw new Error(`Player ${playerId} is already eliminated`);
    }
    if (!player.connected) {
      throw new Error(`Player ${playerId} is already disconnected`);
    }

    const tokenId = randomUUID();
    const expiresAtMs = nowMs + this.reconnectGraceMs;
    const resumeToken = this.buildReconnectToken({
      v: 1,
      sid: this.sessionId,
      pid: playerId,
      jti: tokenId,
      exp: expiresAtMs,
    });

    player.connected = false;
    player.disconnectExpiresAtMs = expiresAtMs;
    player.resumeToken = resumeToken;
    player.resumeTokenId = tokenId;

    this.reconnectTokensById.set(tokenId, {
      playerId,
      expiresAtMs,
      state: "active",
    });

    return {
      playerId,
      resumeToken,
      expiresAtMs,
    };
  }

  reconnectPlayer(resumeToken: string, nowMs: number, expectedPlayerId?: string): ReconnectResult {
    this.pruneReconnectTokenRecords(nowMs);

    const tokenPayload = this.decodeAndVerifyReconnectToken(resumeToken);
    if (!tokenPayload) {
      return {
        connected: false,
        reason: "unknown_token",
      };
    }

    if (expectedPlayerId && tokenPayload.pid !== expectedPlayerId) {
      return {
        connected: false,
        reason: "unknown_token",
      };
    }

    const tokenRecord = this.reconnectTokensById.get(tokenPayload.jti);
    if (!tokenRecord) {
      if (nowMs > tokenPayload.exp) {
        return {
          connected: false,
          reason: "token_expired",
          playerId: tokenPayload.pid,
        };
      }

      return {
        connected: false,
        reason: "unknown_token",
      };
    }

    if (tokenRecord.state === "consumed") {
      return {
        connected: false,
        reason: "token_replayed",
        playerId: tokenRecord.playerId,
      };
    }

    if (tokenRecord.state === "expired") {
      const player = this.players.get(tokenRecord.playerId);
      if (
        player &&
        !player.isEliminated &&
        player.resumeTokenId === tokenPayload.jti &&
        player.disconnectExpiresAtMs !== null
      ) {
        this.markEliminated(player, "disconnected", nowMs);
      }

      return {
        connected: false,
        reason: "token_expired",
        playerId: tokenRecord.playerId,
      };
    }

    const player = this.players.get(tokenPayload.pid);
    if (!player || player.resumeToken !== resumeToken || player.resumeTokenId !== tokenPayload.jti) {
      return {
        connected: false,
        reason: "unknown_token",
      };
    }

    if (
      player.disconnectExpiresAtMs === null ||
      nowMs > player.disconnectExpiresAtMs ||
      nowMs > tokenPayload.exp
    ) {
      this.markEliminated(player, "disconnected", nowMs);

      return {
        connected: false,
        reason: "token_expired",
        playerId: player.playerId,
      };
    }

    player.connected = true;
    player.resumeToken = null;
    player.resumeTokenId = null;
    player.disconnectExpiresAtMs = null;

    this.markReconnectTokenState(tokenPayload.jti, "consumed", nowMs, player.playerId);

    return {
      connected: true,
      playerId: player.playerId,
    };
  }

  resolveExpiredReconnects(nowMs: number): ExpiredReconnectRecord[] {
    this.pruneReconnectTokenRecords(nowMs);
    const expired: ExpiredReconnectRecord[] = [];

    for (const player of this.players.values()) {
      if (player.isEliminated || player.connected || player.disconnectExpiresAtMs === null) {
        continue;
      }

      if (nowMs > player.disconnectExpiresAtMs) {
        const expiredAtMs = player.disconnectExpiresAtMs;
        this.markEliminated(player, "disconnected", nowMs);
        expired.push({
          playerId: player.playerId,
          expiredAtMs,
        });
      }
    }

    return expired;
  }

  submitInput(playerId: string, input: PlayerInput, nowMs = Date.now()): SubmitInputResult {
    const player = this.players.get(playerId);

    if (!player) {
      return { accepted: false, reason: "missing_player" };
    }

    if (!player.connected) {
      return { accepted: false, reason: "disconnected" };
    }

    if (player.isEliminated) {
      return { accepted: false, reason: "eliminated" };
    }

    if (
      this.integrityConfig.enforceInputEnvelope &&
      (!Number.isInteger(input.sequence) ||
        input.sequence < 1 ||
        !Number.isFinite(input.thrust) ||
        input.thrust < -1 ||
        input.thrust > 1)
    ) {
      return { accepted: false, reason: "impossible_input" };
    }

    const limitReason = this.consumeInputBudget(playerId, nowMs);
    if (limitReason) {
      return { accepted: false, reason: limitReason };
    }

    if (input.sequence <= player.lastInputSequence) {
      return { accepted: false, reason: "stale" };
    }

    if (input.sequence !== player.lastInputSequence + 1) {
      return { accepted: false, reason: "out_of_order" };
    }

    player.lastInputSequence = input.sequence;
    player.thrust = clamp(input.thrust, -1, 1);

    return { accepted: true };
  }

  tick(deltaMs: number): SessionSnapshot {
    if (deltaMs <= 0) {
      return this.getSnapshot();
    }

    const deltaSeconds = deltaMs / 1000;

    this.tickCount += 1;
    this.groundRiseSpeed = Math.min(
      this.groundMaxSpeed,
      this.groundRiseSpeed + this.groundAccelerationPerSecond * deltaSeconds,
    );
    this.groundHeight += this.groundRiseSpeed * deltaSeconds;

    for (const player of this.players.values()) {
      if (
        this.integrityConfig.enforceMovementInvariants &&
        player.isEliminated &&
        (Math.abs(player.velocity) > Number.EPSILON || Math.abs(player.thrust) > Number.EPSILON)
      ) {
        this.runtimeIntegrityViolations.push({
          playerId: player.playerId,
          ruleId: INTEGRITY_RULE_IDS.impossibleMovementPostElimMutation,
          category: "movement",
          severity: "critical",
          action: "sanitize_state",
          threshold: 0,
          evidence: {
            velocity: round(player.velocity),
            thrust: round(player.thrust),
            tick: this.tickCount,
          },
          detectedAt: Date.now(),
        });
        player.velocity = 0;
        player.thrust = 0;
      }

      if (player.isEliminated) {
        continue;
      }

      const preTickVelocity = player.velocity;
      const preTickHeight = player.height;
      const thrustAcceleration = player.connected ? player.thrust * this.thrustForcePerSecond : 0;
      const acceleration = thrustAcceleration - this.gravityPerSecond;

      player.velocity += acceleration * deltaSeconds;
      player.height += player.velocity * deltaSeconds;
      player.survivalMs += deltaMs;

      if (this.integrityConfig.enforceMovementInvariants) {
        this.captureKinematicIntegrityViolations({
          player,
          deltaSeconds,
          preTickHeight,
          preTickVelocity,
        });
      }

      if (player.height <= this.groundHeight) {
        player.height = this.groundHeight;
        player.velocity = 0;
        this.markEliminated(player, "ground");
      }
    }

    return this.getSnapshot();
  }

  getSnapshot(): SessionSnapshot {
    const players = [...this.players.values()]
      .map((player) => this.toPlayerSnapshot(player))
      .sort((a, b) => a.playerId.localeCompare(b.playerId));

    const stateHash = createHash("sha256")
      .update(
        JSON.stringify({
          tick: this.tickCount,
          groundHeight: round(this.groundHeight),
          groundRiseSpeed: round(this.groundRiseSpeed),
          players: players.map((player) => ({
            playerId: player.playerId,
            height: round(player.height),
            velocity: round(player.velocity),
            connected: player.connected,
            isEliminated: player.isEliminated,
            eliminationReason: player.eliminationReason,
            seq: player.lastInputSequence,
            reconnectExpiresAtMs: player.reconnectExpiresAtMs,
          })),
        }),
      )
      .digest("hex");

    return {
      sessionId: this.sessionId,
      world: {
        tick: this.tickCount,
        groundHeight: round(this.groundHeight),
        groundRiseSpeed: round(this.groundRiseSpeed),
        stateHash: stateHash.slice(0, 16),
      },
      players,
    };
  }

  drainIntegrityViolations(): RuntimeIntegrityViolation[] {
    if (this.runtimeIntegrityViolations.length === 0) {
      return [];
    }

    const drained = [...this.runtimeIntegrityViolations];
    this.runtimeIntegrityViolations.length = 0;
    return drained;
  }

  private requirePlayer(playerId: string): PlayerState {
    const player = this.players.get(playerId);

    if (!player) {
      throw new Error(`Player ${playerId} is not in session ${this.sessionId}`);
    }

    return player;
  }

  private toPlayerSnapshot(player: PlayerState): PlayerSnapshot {
    return {
      playerId: player.playerId,
      height: round(player.height),
      velocity: round(player.velocity),
      connected: player.connected,
      reconnectExpiresAtMs: player.disconnectExpiresAtMs,
      isEliminated: player.isEliminated,
      eliminationReason: player.eliminationReason,
      lastInputSequence: player.lastInputSequence,
      survivalMs: player.survivalMs,
    };
  }

  private markEliminated(player: PlayerState, reason: "ground" | "disconnected", nowMs = Date.now()): void {
    if (reason === "disconnected" && player.resumeTokenId) {
      this.markReconnectTokenState(player.resumeTokenId, "expired", nowMs, player.playerId);
    }

    player.isEliminated = true;
    player.eliminationReason = reason;
    player.connected = false;
    player.thrust = 0;
    player.resumeToken = null;
    player.resumeTokenId = null;
    if (reason !== "disconnected") {
      player.disconnectExpiresAtMs = null;
    }
  }

  private buildReconnectToken(payload: ReconnectTokenPayload): string {
    const payloadSegment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signatureSegment = createHmac("sha256", this.reconnectTokenSecret)
      .update(payloadSegment)
      .digest("base64url");

    return `pc1.${payloadSegment}.${signatureSegment}`;
  }

  private decodeAndVerifyReconnectToken(token: string): ReconnectTokenPayload | null {
    const segments = token.split(".");
    if (segments.length !== 3 || segments[0] !== "pc1") {
      return null;
    }

    const payloadSegment = segments[1];
    const signatureSegment = segments[2];
    const expectedSignature = createHmac("sha256", this.reconnectTokenSecret)
      .update(payloadSegment)
      .digest("base64url");

    if (!secureEqual(signatureSegment, expectedSignature)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Partial<ReconnectTokenPayload>;
      if (
        payload.v !== 1 ||
        payload.sid !== this.sessionId ||
        typeof payload.pid !== "string" ||
        typeof payload.jti !== "string" ||
        typeof payload.exp !== "number"
      ) {
        return null;
      }

      return {
        v: 1,
        sid: payload.sid,
        pid: payload.pid,
        jti: payload.jti,
        exp: payload.exp,
      };
    } catch {
      return null;
    }
  }

  private markReconnectTokenState(
    tokenId: string,
    nextState: ReconnectTokenRecord["state"],
    nowMs: number,
    playerId: string,
  ): void {
    const existing = this.reconnectTokensById.get(tokenId);
    if (!existing) {
      return;
    }

    const expiresAtMs = existing.expiresAtMs;
    if (nextState === "expired" && existing.state === "consumed") {
      return;
    }

    this.reconnectTokensById.set(tokenId, {
      playerId: existing.playerId || playerId,
      expiresAtMs,
      state: nextState,
    });

    if (nowMs > expiresAtMs + this.reconnectTokenReplayRetentionMs) {
      this.reconnectTokensById.delete(tokenId);
    }
  }

  private pruneReconnectTokenRecords(nowMs: number): void {
    for (const [tokenId, record] of this.reconnectTokensById.entries()) {
      if (record.state === "active" && nowMs > record.expiresAtMs) {
        this.reconnectTokensById.set(tokenId, {
          ...record,
          state: "expired",
        });
        continue;
      }

      if (record.state !== "active" && nowMs > record.expiresAtMs + this.reconnectTokenReplayRetentionMs) {
        this.reconnectTokensById.delete(tokenId);
      }
    }
  }

  private consumeInputBudget(
    playerId: string,
    nowMs: number,
  ): "rate_limited_player" | "rate_limited_room" | null {
    const playerWindow = this.getOrCreatePlayerRateWindow(playerId, nowMs);
    this.refreshRateWindow(this.roomInputWindow, nowMs);

    if (playerWindow.count >= this.playerInputRateLimitPerWindow) {
      return "rate_limited_player";
    }
    if (this.roomInputWindow.count >= this.roomInputRateLimitPerWindow) {
      return "rate_limited_room";
    }

    playerWindow.count += 1;
    this.roomInputWindow.count += 1;

    return null;
  }

  private getOrCreatePlayerRateWindow(playerId: string, nowMs: number): InputRateWindow {
    const existing = this.playerInputWindows.get(playerId);
    if (existing) {
      this.refreshRateWindow(existing, nowMs);
      return existing;
    }

    const created: InputRateWindow = {
      windowStartMs: nowMs,
      count: 0,
    };
    this.playerInputWindows.set(playerId, created);
    return created;
  }

  private refreshRateWindow(window: InputRateWindow, nowMs: number): void {
    if (nowMs < window.windowStartMs || nowMs - window.windowStartMs >= this.inputRateWindowMs) {
      window.windowStartMs = nowMs;
      window.count = 0;
    }
  }

  private captureKinematicIntegrityViolations(input: {
    player: PlayerState;
    deltaSeconds: number;
    preTickHeight: number;
    preTickVelocity: number;
  }): void {
    const maxAccelerationMagnitude = this.thrustForcePerSecond + this.gravityPerSecond;
    const velocityDelta = Math.abs(input.player.velocity - input.preTickVelocity);
    const velocityCap =
      maxAccelerationMagnitude *
      input.deltaSeconds *
      (1 + this.integrityConfig.movementVelocitySlackPct);

    if (velocityDelta > velocityCap) {
      this.runtimeIntegrityViolations.push({
        playerId: input.player.playerId,
        ruleId: INTEGRITY_RULE_IDS.impossibleMovementVelocityDelta,
        category: "movement",
        severity: "critical",
        action: "quarantine_session",
        threshold: round(velocityCap),
        evidence: {
          observedVelocityDelta: round(velocityDelta),
          preTickVelocity: round(input.preTickVelocity),
          postTickVelocity: round(input.player.velocity),
          tick: this.tickCount,
        },
        detectedAt: Date.now(),
      });
    }

    const heightDelta = Math.abs(input.player.height - input.preTickHeight);
    const heightCap =
      Math.abs(input.preTickVelocity) * input.deltaSeconds +
      0.5 * maxAccelerationMagnitude * input.deltaSeconds * input.deltaSeconds +
      this.integrityConfig.movementHeightSlackUnits;

    if (heightDelta > heightCap) {
      this.runtimeIntegrityViolations.push({
        playerId: input.player.playerId,
        ruleId: INTEGRITY_RULE_IDS.impossibleMovementHeightDelta,
        category: "movement",
        severity: "critical",
        action: "quarantine_session",
        threshold: round(heightCap),
        evidence: {
          observedHeightDelta: round(heightDelta),
          preTickHeight: round(input.preTickHeight),
          postTickHeight: round(input.player.height),
          tick: this.tickCount,
        },
        detectedAt: Date.now(),
      });
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function toPerWindowLimit(limitPerSecond: number, windowMs: number): number {
  const normalizedLimit = Math.max(1, limitPerSecond);
  return Math.max(1, Math.floor((normalizedLimit * windowMs) / 1000));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
