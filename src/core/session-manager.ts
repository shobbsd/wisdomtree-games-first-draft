import type { PlayerInput } from "../types.js";
import { LeaderboardService, type RecordMatchResultOutput } from "../leaderboard/leaderboard-service.js";
import { InMemoryEventSink } from "../telemetry/event-sink.js";
import { MultiplayerSession } from "./multiplayer-session.js";

interface SessionManagerOptions {
  eventSink: InMemoryEventSink;
  leaderboard: LeaderboardService;
}

interface CreateRoomInput {
  sessionId: string;
  nowMs: number;
}

interface JoinRoomOptions {
  spawnHeight?: number;
  nowMs: number;
}

interface CompleteRoomOptions {
  recordedAt: number;
}

export class SessionManager {
  private readonly eventSink: InMemoryEventSink;

  private readonly leaderboard: LeaderboardService;

  private readonly sessions = new Map<string, MultiplayerSession>();

  constructor(options: SessionManagerOptions) {
    this.eventSink = options.eventSink;
    this.leaderboard = options.leaderboard;
  }

  createRoom(input: CreateRoomInput): { sessionId: string } {
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Session ${input.sessionId} already exists`);
    }

    const session = new MultiplayerSession({ sessionId: input.sessionId });
    this.sessions.set(input.sessionId, session);

    this.eventSink.emit("session.lifecycle.created", {
      sessionId: input.sessionId,
      nowMs: input.nowMs,
    });

    return { sessionId: input.sessionId };
  }

  joinRoom(sessionId: string, playerId: string, options: JoinRoomOptions): void {
    const session = this.requireSession(sessionId);
    session.joinPlayer(playerId, options);

    this.eventSink.emit("session.lifecycle.player_joined", {
      sessionId,
      playerId,
      nowMs: options.nowMs,
    });
  }

  submitInput(sessionId: string, playerId: string, input: PlayerInput): void {
    const session = this.requireSession(sessionId);
    const result = session.submitInput(playerId, input);

    this.eventSink.emit(result.accepted ? "session.input.accepted" : "session.input.rejected", {
      sessionId,
      playerId,
      sequence: input.sequence,
      result,
    });
  }

  advanceRoom(sessionId: string, deltaMs: number): void {
    const session = this.requireSession(sessionId);
    const snapshot = session.tick(deltaMs);

    this.eventSink.emit("session.lifecycle.tick", {
      sessionId,
      tick: snapshot.world.tick,
      groundHeight: snapshot.world.groundHeight,
      stateHash: snapshot.world.stateHash,
    });
  }

  completeRoom(sessionId: string, options: CompleteRoomOptions): RecordMatchResultOutput {
    const session = this.requireSession(sessionId);
    const snapshot = session.getSnapshot();

    const entries = snapshot.players.map((player) => ({
      playerId: player.playerId,
      score: Math.max(0, Math.round(player.survivalMs / 100 + player.height * 10 - (player.isEliminated ? 40 : 0))),
      survivalMs: player.survivalMs,
    }));

    const result = this.leaderboard.recordMatchResult({
      sessionId,
      recordedAt: options.recordedAt,
      entries,
    });

    this.sessions.delete(sessionId);

    this.eventSink.emit("session.lifecycle.completed", {
      sessionId,
      players: entries.length,
      recordedAt: options.recordedAt,
    });

    return result;
  }

  private requireSession(sessionId: string): MultiplayerSession {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return session;
  }
}
