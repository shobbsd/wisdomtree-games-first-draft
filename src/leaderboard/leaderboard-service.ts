import { createHash } from "node:crypto";

import type { MatchResultEntry } from "../types.js";
import {
  type DurableStateStore,
  type PersistedMatchFinalEvent,
} from "../persistence/file-durable-state-store.js";
import { InMemoryEventSink } from "../telemetry/event-sink.js";
import { RollingWindow } from "../telemetry/rolling-window.js";

export interface LeaderboardRecord {
  rank: number;
  playerId: string;
  score: number;
  survivalMs: number;
  isTie: boolean;
  placementToken: string;
  updatedAt: number;
  sessionId: string;
}

export interface RecordMatchResultInput {
  eventId?: string;
  sessionId: string;
  recordedAt: number;
  entries: MatchResultEntry[];
}

export interface RecordMatchResultOutput {
  eventId: string;
  idempotent: boolean;
  sessionId: string;
  processedEntries: number;
  standings: LeaderboardRecord[];
  commits: MatchResultCommitRecord[];
}

export interface MatchResultCommitRecord {
  playerId: string;
  previousRank: number | null;
  rank: number;
  rankDelta: number | null;
  isTie: boolean;
  placementToken: string;
  score: number;
  survivalMs: number;
}

interface LeaderboardServiceOptions {
  eventSink: InMemoryEventSink;
  durableStore?: DurableStateStore;
}

interface MutableLeaderboardRecord {
  playerId: string;
  score: number;
  survivalMs: number;
  updatedAt: number;
  sessionId: string;
}

interface MatchEventFingerprint {
  sessionId: string;
  entriesDigest: string;
  signature: string;
}

type IntegrityMismatchKind = "session" | "entries";

export class LeaderboardService {
  private readonly eventSink: InMemoryEventSink;

  private readonly recordsByPlayer = new Map<string, MutableLeaderboardRecord>();

  private readonly durableStore?: DurableStateStore;

  private readonly writeLatencyWindow = new RollingWindow();

  private readonly processedEventIds = new Set<string>();

  private readonly eventFingerprintsById = new Map<string, MatchEventFingerprint>();

  private writeAttempts = 0;

  private writeFailures = 0;

  constructor(options: LeaderboardServiceOptions) {
    this.eventSink = options.eventSink;
    this.durableStore = options.durableStore;
    this.recoverFromDurableStore();
  }

  recordMatchResult(input: RecordMatchResultInput): RecordMatchResultOutput {
    const eventId = input.eventId ?? `match-final:${input.sessionId}`;
    const writeStartedAt = performance.now();
    this.writeAttempts += 1;
    let success = false;

    try {
      const incomingFingerprint = createMatchEventFingerprint(input.sessionId, input.entries);

      if (this.processedEventIds.has(eventId)) {
        const recordedFingerprint = this.eventFingerprintsById.get(eventId);
        const standings = this.getStandings();
        const topStanding = standings[0];
        const quarantined =
          recordedFingerprint !== undefined &&
          recordedFingerprint.signature !== incomingFingerprint.signature;

        if (quarantined && recordedFingerprint) {
          const mismatchKinds: IntegrityMismatchKind[] = [];
          if (recordedFingerprint.sessionId !== incomingFingerprint.sessionId) {
            mismatchKinds.push("session");
          }
          if (recordedFingerprint.entriesDigest !== incomingFingerprint.entriesDigest) {
            mismatchKinds.push("entries");
          }

          this.eventSink.emit("leaderboard.integrity.mismatch_quarantined", {
            eventId,
            sessionId: input.sessionId,
            quarantined: true,
            reason: "event_payload_mismatch",
            mismatchKinds,
            expected: {
              sessionId: recordedFingerprint.sessionId,
              signature: recordedFingerprint.signature,
              entriesDigest: recordedFingerprint.entriesDigest,
            },
            received: {
              sessionId: incomingFingerprint.sessionId,
              signature: incomingFingerprint.signature,
              entriesDigest: incomingFingerprint.entriesDigest,
            },
          });
        }

        this.eventSink.emit("leaderboard.write", {
          eventId,
          idempotent: true,
          quarantined,
          integrityReason: quarantined ? "event_payload_mismatch" : null,
          sessionId: input.sessionId,
          recordedAt: input.recordedAt,
          entries: input.entries.length,
          topPlayerId: topStanding?.playerId ?? null,
          topScore: topStanding?.score ?? null,
          commits: 0,
        });

        success = true;
        return {
          eventId,
          idempotent: true,
          sessionId: input.sessionId,
          processedEntries: input.entries.length,
          standings,
          commits: [],
        };
      }

      const persistedEvent: PersistedMatchFinalEvent = {
        eventId,
        sessionId: input.sessionId,
        recordedAt: input.recordedAt,
        entries: input.entries,
      };
      this.durableStore?.appendMatchFinalEvent(persistedEvent);

      const previousRankByPlayer = new Map(
        this.getStandings().map((standing) => [standing.playerId, standing.rank]),
      );

      this.applyEntries(input.entries, input.sessionId, input.recordedAt);
      this.processedEventIds.add(eventId);
      this.eventFingerprintsById.set(eventId, incomingFingerprint);

      const standings = this.getStandings();
      const standingByPlayer = new Map(standings.map((standing) => [standing.playerId, standing]));
      const commits = this.buildCommitRecords(input.entries, previousRankByPlayer, standingByPlayer);
      const topStanding = standings[0];

      this.eventSink.emit("leaderboard.write", {
        eventId,
        idempotent: false,
        quarantined: false,
        integrityReason: null,
        sessionId: input.sessionId,
        recordedAt: input.recordedAt,
        entries: input.entries.length,
        topPlayerId: topStanding?.playerId ?? null,
        topScore: topStanding?.score ?? null,
        commits: commits.length,
      });

      success = true;
      return {
        eventId,
        idempotent: false,
        sessionId: input.sessionId,
        processedEntries: input.entries.length,
        standings,
        commits,
      };
    } catch (error) {
      this.writeFailures += 1;
      throw error;
    } finally {
      const writeLatencyMs = Math.max(0, performance.now() - writeStartedAt);
      this.writeLatencyWindow.push(writeLatencyMs);

      this.eventSink.emit("leaderboard.slo.write_latency", {
        eventId,
        sessionId: input.sessionId,
        recordedAt: input.recordedAt,
        success,
        latencyMs: roundMetric(writeLatencyMs),
        p95LatencyMs: roundMetric(this.writeLatencyWindow.percentile(95)),
        p99LatencyMs: roundMetric(this.writeLatencyWindow.percentile(99)),
        sampleSize: this.writeLatencyWindow.size,
        attempts: this.writeAttempts,
        failures: this.writeFailures,
        failureRate: roundMetric(this.writeFailures / this.writeAttempts),
      });
    }
  }

  private recoverFromDurableStore(): void {
    if (!this.durableStore) {
      return;
    }

    for (const event of this.durableStore.listMatchFinalEvents()) {
      if (this.processedEventIds.has(event.eventId)) {
        continue;
      }

      this.applyEntries(event.entries, event.sessionId, event.recordedAt);
      this.processedEventIds.add(event.eventId);
      this.eventFingerprintsById.set(
        event.eventId,
        createMatchEventFingerprint(event.sessionId, event.entries),
      );
    }
  }

  private applyEntries(entries: MatchResultEntry[], sessionId: string, recordedAt: number): void {
    for (const entry of entries) {
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
        updatedAt: recordedAt,
        sessionId,
      });
    }
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

    const tieCounts = new Map<string, number>();
    for (const entry of sorted) {
      const key = getTieKey(entry.score, entry.survivalMs);
      tieCounts.set(key, (tieCounts.get(key) ?? 0) + 1);
    }

    let rank = 0;
    let previous: MutableLeaderboardRecord | null = null;

    return sorted.slice(0, limit).map((entry, index) => {
      if (
        previous &&
        previous.score === entry.score &&
        previous.survivalMs === entry.survivalMs
      ) {
        // Tie group shares rank with the first member.
      } else {
        rank = index + 1;
      }

      previous = entry;

      const isTie = (tieCounts.get(getTieKey(entry.score, entry.survivalMs)) ?? 0) > 1;
      const placementToken = isTie ? `T-${rank}` : `${rank}`;

      return {
        rank,
        playerId: entry.playerId,
        score: entry.score,
        survivalMs: entry.survivalMs,
        isTie,
        placementToken,
        updatedAt: entry.updatedAt,
        sessionId: entry.sessionId,
      };
    });
  }

  private buildCommitRecords(
    entries: MatchResultEntry[],
    previousRankByPlayer: Map<string, number>,
    standingByPlayer: Map<string, LeaderboardRecord>,
  ): MatchResultCommitRecord[] {
    const committedByPlayer = new Map<string, MatchResultCommitRecord>();

    for (const entry of entries) {
      const standing = standingByPlayer.get(entry.playerId);
      if (!standing) {
        continue;
      }

      const previousRank = previousRankByPlayer.get(entry.playerId) ?? null;

      committedByPlayer.set(entry.playerId, {
        playerId: entry.playerId,
        previousRank,
        rank: standing.rank,
        rankDelta: previousRank === null ? null : previousRank - standing.rank,
        isTie: standing.isTie,
        placementToken: standing.placementToken,
        score: standing.score,
        survivalMs: standing.survivalMs,
      });
    }

    return [...committedByPlayer.values()].sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }

      return left.playerId.localeCompare(right.playerId);
    });
  }
}

function getTieKey(score: number, survivalMs: number): string {
  return `${score}:${survivalMs}`;
}

function createMatchEventFingerprint(
  sessionId: string,
  entries: MatchResultEntry[],
): MatchEventFingerprint {
  const canonicalEntries = entries
    .map((entry) => ({
      playerId: entry.playerId,
      score: entry.score,
      survivalMs: entry.survivalMs,
    }))
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  const entriesDigest = createHash("sha256").update(JSON.stringify(canonicalEntries)).digest("hex");
  const signature = createHash("sha256")
    .update(JSON.stringify({ sessionId, entriesDigest }))
    .digest("hex");

  return {
    sessionId,
    entriesDigest,
    signature,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
