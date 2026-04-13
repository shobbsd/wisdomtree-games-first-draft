import type { MatchResultEntry } from "../types.js";
import { InMemoryEventSink } from "../telemetry/event-sink.js";

export interface LeaderboardRecord {
  rank: number;
  playerId: string;
  score: number;
  survivalMs: number;
  updatedAt: number;
  sessionId: string;
}

export interface RecordMatchResultInput {
  sessionId: string;
  recordedAt: number;
  entries: MatchResultEntry[];
}

export interface RecordMatchResultOutput {
  sessionId: string;
  processedEntries: number;
  standings: LeaderboardRecord[];
}

interface LeaderboardServiceOptions {
  eventSink: InMemoryEventSink;
}

interface MutableLeaderboardRecord {
  playerId: string;
  score: number;
  survivalMs: number;
  updatedAt: number;
  sessionId: string;
}

export class LeaderboardService {
  private readonly eventSink: InMemoryEventSink;

  private readonly recordsByPlayer = new Map<string, MutableLeaderboardRecord>();

  constructor(options: LeaderboardServiceOptions) {
    this.eventSink = options.eventSink;
  }

  recordMatchResult(input: RecordMatchResultInput): RecordMatchResultOutput {
    for (const entry of input.entries) {
      const current = this.recordsByPlayer.get(entry.playerId);
      const shouldReplace =
        !current ||
        entry.score > current.score ||
        (entry.score === current.score && entry.survivalMs > current.survivalMs);

      if (!shouldReplace) {
        continue;
      }

      this.recordsByPlayer.set(entry.playerId, {
        playerId: entry.playerId,
        score: entry.score,
        survivalMs: entry.survivalMs,
        updatedAt: input.recordedAt,
        sessionId: input.sessionId,
      });
    }

    const standings = this.getStandings();
    const topStanding = standings[0];

    this.eventSink.emit("leaderboard.write", {
      sessionId: input.sessionId,
      recordedAt: input.recordedAt,
      entries: input.entries.length,
      topPlayerId: topStanding?.playerId ?? null,
      topScore: topStanding?.score ?? null,
    });

    return {
      sessionId: input.sessionId,
      processedEntries: input.entries.length,
      standings,
    };
  }

  getStandings(limit = 50): LeaderboardRecord[] {
    const sorted = [...this.recordsByPlayer.values()].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.survivalMs !== a.survivalMs) {
        return b.survivalMs - a.survivalMs;
      }

      return a.playerId.localeCompare(b.playerId);
    });

    return sorted.slice(0, limit).map((entry, index) => ({
      rank: index + 1,
      playerId: entry.playerId,
      score: entry.score,
      survivalMs: entry.survivalMs,
      updatedAt: entry.updatedAt,
      sessionId: entry.sessionId,
    }));
  }
}
