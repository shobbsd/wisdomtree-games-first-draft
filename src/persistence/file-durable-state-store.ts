import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { MatchResultEntry, PlayerSnapshot, WorldSnapshot } from "../types.js";

export interface PersistedSessionSnapshot {
  eventId: string;
  sessionId: string;
  revision: number;
  phase: "lobby" | "in_round" | "results";
  capturedAt: number;
  world: WorldSnapshot;
  players: PlayerSnapshot[];
  reason: string;
  completedAt: number | null;
}

export interface PersistedMatchFinalEvent {
  eventId: string;
  sessionId: string;
  recordedAt: number;
  entries: MatchResultEntry[];
}

interface DurableStateDocument {
  version: 1;
  sessionSnapshots: PersistedSessionSnapshot[];
  matchFinalEvents: PersistedMatchFinalEvent[];
}

export interface DurableStateStore {
  appendSessionSnapshot(snapshot: PersistedSessionSnapshot): { appended: boolean };
  appendMatchFinalEvent(event: PersistedMatchFinalEvent): { appended: boolean };
  listSessionSnapshots(sessionId?: string): PersistedSessionSnapshot[];
  listMatchFinalEvents(): PersistedMatchFinalEvent[];
  hasMatchFinalEvent(eventId: string): boolean;
}

const EMPTY_STATE: DurableStateDocument = {
  version: 1,
  sessionSnapshots: [],
  matchFinalEvents: [],
};

export class FileDurableStateStore implements DurableStateStore {
  private readonly filePath: string;

  private readonly sessionSnapshotEventIds = new Set<string>();

  private readonly matchFinalEventIds = new Set<string>();

  private readonly state: DurableStateDocument;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
    this.state = this.loadStateFromDisk();
    this.indexState();
  }

  appendSessionSnapshot(snapshot: PersistedSessionSnapshot): { appended: boolean } {
    if (this.sessionSnapshotEventIds.has(snapshot.eventId)) {
      return { appended: false };
    }

    this.state.sessionSnapshots.push(structuredClone(snapshot));
    this.sessionSnapshotEventIds.add(snapshot.eventId);
    this.persistStateToDisk();

    return { appended: true };
  }

  appendMatchFinalEvent(event: PersistedMatchFinalEvent): { appended: boolean } {
    if (this.matchFinalEventIds.has(event.eventId)) {
      return { appended: false };
    }

    this.state.matchFinalEvents.push(structuredClone(event));
    this.matchFinalEventIds.add(event.eventId);
    this.persistStateToDisk();

    return { appended: true };
  }

  listSessionSnapshots(sessionId?: string): PersistedSessionSnapshot[] {
    const snapshots = sessionId
      ? this.state.sessionSnapshots.filter((snapshot) => snapshot.sessionId === sessionId)
      : this.state.sessionSnapshots;

    return structuredClone(snapshots);
  }

  listMatchFinalEvents(): PersistedMatchFinalEvent[] {
    return structuredClone(this.state.matchFinalEvents);
  }

  hasMatchFinalEvent(eventId: string): boolean {
    return this.matchFinalEventIds.has(eventId);
  }

  private loadStateFromDisk(): DurableStateDocument {
    if (!existsSync(this.filePath)) {
      return structuredClone(EMPTY_STATE);
    }

    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<DurableStateDocument>;
      const normalized: DurableStateDocument = {
        version: 1,
        sessionSnapshots: [],
        matchFinalEvents: [],
      };

      if (Array.isArray(raw.sessionSnapshots)) {
        for (const item of raw.sessionSnapshots) {
          if (!isPersistedSessionSnapshot(item)) {
            continue;
          }
          if (normalized.sessionSnapshots.some((snapshot) => snapshot.eventId === item.eventId)) {
            continue;
          }
          normalized.sessionSnapshots.push(item);
        }
      }

      if (Array.isArray(raw.matchFinalEvents)) {
        for (const item of raw.matchFinalEvents) {
          if (!isPersistedMatchFinalEvent(item)) {
            continue;
          }
          if (normalized.matchFinalEvents.some((event) => event.eventId === item.eventId)) {
            continue;
          }
          normalized.matchFinalEvents.push(item);
        }
      }

      return normalized;
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private indexState(): void {
    for (const snapshot of this.state.sessionSnapshots) {
      this.sessionSnapshotEventIds.add(snapshot.eventId);
    }
    for (const event of this.state.matchFinalEvents) {
      this.matchFinalEventIds.add(event.eventId);
    }
  }

  private persistStateToDisk(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.tmp-${process.pid}`;
    const payload = JSON.stringify(this.state, null, 2);
    writeFileSync(tempPath, payload, "utf8");
    renameSync(tempPath, this.filePath);
  }
}

function isPersistedSessionSnapshot(value: unknown): value is PersistedSessionSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as PersistedSessionSnapshot;
  return (
    typeof candidate.eventId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.revision === "number" &&
    (candidate.phase === "lobby" || candidate.phase === "in_round" || candidate.phase === "results") &&
    typeof candidate.capturedAt === "number" &&
    typeof candidate.reason === "string" &&
    Array.isArray(candidate.players) &&
    Boolean(candidate.world)
  );
}

function isPersistedMatchFinalEvent(value: unknown): value is PersistedMatchFinalEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as PersistedMatchFinalEvent;
  return (
    typeof candidate.eventId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.recordedAt === "number" &&
    Array.isArray(candidate.entries)
  );
}
