import { createHash } from "node:crypto";

import type { PlayerInput, PlayerSnapshot, SessionSnapshot } from "../types.js";

interface MultiplayerSessionOptions {
  sessionId: string;
  groundStartSpeed?: number;
  groundAccelerationPerSecond?: number;
  groundMaxSpeed?: number;
  reconnectGraceMs?: number;
  gravityPerSecond?: number;
  thrustForcePerSecond?: number;
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
  lastInputSequence: number;
  survivalMs: number;
  disconnectExpiresAtMs: number | null;
  resumeToken: string | null;
}

interface DisconnectResult {
  playerId: string;
  resumeToken: string;
  expiresAtMs: number;
}

interface ReconnectResult {
  connected: boolean;
  playerId?: string;
  reason?: "unknown_token" | "token_expired";
}

type SubmitInputResult =
  | { accepted: true }
  | { accepted: false; reason: "stale" | "out_of_order" | "missing_player" | "disconnected" | "eliminated" };

export class MultiplayerSession {
  readonly sessionId: string;

  private readonly reconnectGraceMs: number;

  private readonly groundAccelerationPerSecond: number;

  private readonly groundMaxSpeed: number;

  private readonly gravityPerSecond: number;

  private readonly thrustForcePerSecond: number;

  private readonly players = new Map<string, PlayerState>();

  private tokenCounter = 0;

  private tickCount = 0;

  private groundHeight = 0;

  private groundRiseSpeed: number;

  constructor(options: MultiplayerSessionOptions) {
    this.sessionId = options.sessionId;
    this.reconnectGraceMs = options.reconnectGraceMs ?? 30_000;
    this.groundRiseSpeed = options.groundStartSpeed ?? 0.5;
    this.groundAccelerationPerSecond = options.groundAccelerationPerSecond ?? 0.12;
    this.groundMaxSpeed = options.groundMaxSpeed ?? 4.5;
    this.gravityPerSecond = options.gravityPerSecond ?? 1.5;
    this.thrustForcePerSecond = options.thrustForcePerSecond ?? 3;
  }

  joinPlayer(playerId: string, options: JoinPlayerOptions): PlayerSnapshot {
    if (this.players.has(playerId)) {
      throw new Error(`Player ${playerId} already joined`);
    }

    const state: PlayerState = {
      playerId,
      height: options.spawnHeight ?? 5,
      velocity: 0,
      thrust: 0,
      connected: true,
      isEliminated: false,
      lastInputSequence: 0,
      survivalMs: 0,
      disconnectExpiresAtMs: null,
      resumeToken: null,
    };

    this.players.set(playerId, state);

    return this.toPlayerSnapshot(state);
  }

  disconnectPlayer(playerId: string, nowMs: number): DisconnectResult {
    const player = this.requirePlayer(playerId);

    const resumeToken = `${this.sessionId}:${playerId}:${++this.tokenCounter}`;
    const expiresAtMs = nowMs + this.reconnectGraceMs;

    player.connected = false;
    player.disconnectExpiresAtMs = expiresAtMs;
    player.resumeToken = resumeToken;

    return {
      playerId,
      resumeToken,
      expiresAtMs,
    };
  }

  reconnectPlayer(resumeToken: string, nowMs: number): ReconnectResult {
    for (const player of this.players.values()) {
      if (player.resumeToken !== resumeToken) {
        continue;
      }

      if (player.disconnectExpiresAtMs !== null && nowMs > player.disconnectExpiresAtMs) {
        player.resumeToken = null;
        player.disconnectExpiresAtMs = null;

        return {
          connected: false,
          reason: "token_expired",
          playerId: player.playerId,
        };
      }

      player.connected = true;
      player.resumeToken = null;
      player.disconnectExpiresAtMs = null;

      return {
        connected: true,
        playerId: player.playerId,
      };
    }

    return {
      connected: false,
      reason: "unknown_token",
    };
  }

  submitInput(playerId: string, input: PlayerInput): SubmitInputResult {
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
      if (player.isEliminated) {
        continue;
      }

      const thrustAcceleration = player.connected ? player.thrust * this.thrustForcePerSecond : 0;
      const acceleration = thrustAcceleration - this.gravityPerSecond;

      player.velocity += acceleration * deltaSeconds;
      player.height += player.velocity * deltaSeconds;
      player.survivalMs += deltaMs;

      if (player.height <= this.groundHeight) {
        player.height = this.groundHeight;
        player.velocity = 0;
        player.isEliminated = true;
        player.connected = false;
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
            seq: player.lastInputSequence,
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
      isEliminated: player.isEliminated,
      lastInputSequence: player.lastInputSequence,
      survivalMs: player.survivalMs,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
