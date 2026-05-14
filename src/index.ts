import { join } from "node:path";

export {
  AuthoritativeMatchSessionService,
  replayAuthoritativeMatchSessionLog,
} from "./core/authoritative-match-session-service.js";
export type {
  AuthoritativeMatchSessionServiceOptions,
  CreateMatchInput,
  MatchClientIntent,
  MatchEventLogEntry,
  MatchRuntimeState,
  MatchSeedPlayer,
  ReplayVerification,
  SubmitIntentResult,
} from "./core/authoritative-match-session-service.js";
import { SessionManager } from "./core/session-manager.js";
import { LeaderboardService } from "./leaderboard/leaderboard-service.js";
import { FileDurableStateStore } from "./persistence/file-durable-state-store.js";
import { InMemoryEventSink } from "./telemetry/event-sink.js";
export { HttpRoomTransport } from "./transport/http-room-transport.js";

export {
  PRIORITY_DWELL_MS,
  PriorityMessageChannel,
  createQueueTimeoutFallback,
} from "./ux/priority-message-channel.js";
export {
  WIS215_FIRST_SESSION_ONBOARDING_CUES,
  WIS215_FIRST_SESSION_ONBOARDING_ORDER,
  isWis215FirstSessionOnboardingCueId,
} from "./ux/wis215-first-session-onboarding-contract.js";
export {
  WIS511_EVENT_SCHEMAS,
  WIS511_EVENT_TYPES,
  WIS511_REQUIRED_ANALYTICS_EVENT_SET,
  WIS511_SCHEMA_REGISTRY_VERSION,
  WIS511_SESSION_IDENTITY_TOKEN_SCHEMA_ID,
  isSessionIdentityTokenClaimsV1,
  parseSessionIdentityTokenClaimsV1,
  validateEventPayload,
  validateRequiredAnalyticsEventSet,
  validateSessionIdentityTokenClaimsV1,
} from "./contracts/wis511-session-identity-event-schema-registry.js";
export {
  DEFAULT_SESSION_INTEGRITY_CONFIG,
  INTEGRITY_RULE_IDS,
  resolveSessionIntegrityConfig,
} from "./core/session-integrity.js";
export type {
  ActivePriorityChannelMessage,
  MessagePriority,
  PriorityChannelMessage,
  PriorityChannelSnapshot,
  QueueTimeoutFallback,
  QueueTimeoutFallbackPayload,
} from "./ux/priority-message-channel.js";
export type { Wis215FirstSessionOnboardingCueId } from "./ux/wis215-first-session-onboarding-contract.js";
export type {
  AnalyticsEventRequirement,
  EventPayloadValidationResult,
  EventSchemaDefinition,
  RequiredEventSetValidationResult,
  SchemaValidationIssue,
  SchemaValidationResult,
  SessionIdentityTokenClaimsV1,
} from "./contracts/wis511-session-identity-event-schema-registry.js";
export type {
  IntegrityAction,
  IntegrityCategory,
  IntegritySeverity,
  RuntimeIntegrityViolation,
  SessionIntegrityConfig,
} from "./core/session-integrity.js";
export {
  FileDurableStateStore,
} from "./persistence/file-durable-state-store.js";
export type {
  DurableStateStore,
  PersistedMatchFinalEvent,
  PersistedSessionSnapshot,
} from "./persistence/file-durable-state-store.js";

export interface BaselineRuntime {
  sessions: SessionManager;
  leaderboard: LeaderboardService;
  events: InMemoryEventSink;
}

export interface BaselineRuntimeOptions {
  durableStateFilePath?: string | null;
}

export function createBaselineRuntime(options: BaselineRuntimeOptions = {}): BaselineRuntime {
  const events = new InMemoryEventSink();
  const stateFilePath =
    options.durableStateFilePath === undefined
      ? join(process.cwd(), ".runtime", "durable-state.json")
      : options.durableStateFilePath;
  const durableStore = stateFilePath ? new FileDurableStateStore({ filePath: stateFilePath }) : undefined;
  const leaderboard = new LeaderboardService({ eventSink: events, durableStore });
  const sessions = new SessionManager({ eventSink: events, leaderboard, durableStore });

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
