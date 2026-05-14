export interface PlayerInput {
  sequence: number;
  thrust: number;
}

export interface PlayerSnapshot {
  playerId: string;
  height: number;
  velocity: number;
  connected: boolean;
  reconnectExpiresAtMs: number | null;
  isEliminated: boolean;
  eliminationReason: "ground" | "disconnected" | null;
  lastInputSequence: number;
  survivalMs: number;
}

export interface WorldSnapshot {
  tick: number;
  groundHeight: number;
  groundRiseSpeed: number;
  stateHash: string;
}

export interface SessionSnapshot {
  sessionId: string;
  world: WorldSnapshot;
  players: PlayerSnapshot[];
}

export interface MatchResultEntry {
  playerId: string;
  score: number;
  survivalMs: number;
}
