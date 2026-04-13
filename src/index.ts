import { SessionManager } from "./core/session-manager.js";
import { LeaderboardService } from "./leaderboard/leaderboard-service.js";
import { InMemoryEventSink } from "./telemetry/event-sink.js";

export interface BaselineRuntime {
  sessions: SessionManager;
  leaderboard: LeaderboardService;
  events: InMemoryEventSink;
}

export function createBaselineRuntime(): BaselineRuntime {
  const events = new InMemoryEventSink();
  const leaderboard = new LeaderboardService({ eventSink: events });
  const sessions = new SessionManager({ eventSink: events, leaderboard });

  return {
    sessions,
    leaderboard,
    events,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = createBaselineRuntime();

  runtime.sessions.createRoom({ sessionId: "demo-room", nowMs: Date.now() });
  runtime.sessions.joinRoom("demo-room", "runner-a", { nowMs: Date.now(), spawnHeight: 5 });
  runtime.sessions.joinRoom("demo-room", "runner-b", { nowMs: Date.now(), spawnHeight: 4.5 });

  runtime.sessions.submitInput("demo-room", "runner-a", { sequence: 1, thrust: 0.2 });
  runtime.sessions.submitInput("demo-room", "runner-b", { sequence: 1, thrust: 0.1 });

  runtime.sessions.advanceRoom("demo-room", 500);
  runtime.sessions.advanceRoom("demo-room", 500);

  const match = runtime.sessions.completeRoom("demo-room", { recordedAt: Date.now() });

  console.log(JSON.stringify({ match, events: runtime.events.countersByType() }, null, 2));
}
