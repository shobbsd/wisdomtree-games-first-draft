import type { PlayerInput, PlayerSnapshot, SessionSnapshot, WorldSnapshot } from "../types.js";
import { LeaderboardService, type RecordMatchResultOutput } from "../leaderboard/leaderboard-service.js";
import {
  type DurableStateStore,
  type PersistedSessionSnapshot,
} from "../persistence/file-durable-state-store.js";
import { InMemoryEventSink } from "../telemetry/event-sink.js";
import { RollingWindow } from "../telemetry/rolling-window.js";
import {
  createQueueTimeoutFallback,
  type QueueTimeoutFallbackPayload,
} from "../ux/priority-message-channel.js";
import {
  WIS135_RISING_GROUND_COPY,
  WIS135_RISING_GROUND_EVENT_NAMES,
  WIS135_RISING_GROUND_TIMING_MS,
  WIS135_RISING_GROUND_VISIBILITY,
  type Wis135RisingGroundDangerTier,
  type Wis135RisingGroundRuntimeState,
} from "../ux/wis135-rising-ground-contract.js";
import { WIS214_GAME_OVER_COPY, WIS214_GAME_OVER_TIMING_MS } from "../ux/wis214-game-over-feedback-contract.js";
import {
  WIS215_FIRST_SESSION_ONBOARDING_CUES,
  WIS215_FIRST_SESSION_ONBOARDING_ORDER,
  isWis215FirstSessionOnboardingCueId,
  type Wis215FirstSessionOnboardingCueId,
} from "../ux/wis215-first-session-onboarding-contract.js";
import {
  WIS216_ACCESSIBILITY_BASELINE,
  resolveWis216AnnouncementPolicy,
  type Wis216LiveRegionPolicy,
} from "../ux/wis216-accessibility-baseline-contract.js";
import {
  MultiplayerSession,
  type DisconnectResult,
  type ReconnectResult,
  type SubmitInputResult,
} from "./multiplayer-session.js";
import {
  DEFAULT_SESSION_INTEGRITY_CONFIG,
  INTEGRITY_RULE_IDS,
  resolveSessionIntegrityConfig,
  type IntegrityAction,
  type IntegrityCategory,
  type IntegritySeverity,
  type RuntimeIntegrityViolation,
  type SessionIntegrityConfig,
} from "./session-integrity.js";

interface SessionManagerOptions {
  eventSink: InMemoryEventSink;
  leaderboard: LeaderboardService;
  durableStore?: DurableStateStore;
  integrityConfig?: Partial<SessionIntegrityConfig>;
}

interface CreateRoomInput {
  sessionId: string;
  nowMs: number;
  maxPlayers?: number;
  reconnectGraceMs?: number;
  reconnectTokenSecret?: string;
  reconnectTokenReplayRetentionMs?: number;
  playerInputRateLimitPerSecond?: number;
  roomInputRateLimitPerSecond?: number;
  inputRateWindowMs?: number;
}

interface JoinRoomOptions {
  spawnHeight?: number;
  nowMs: number;
}

interface DisconnectPlayerOptions {
  nowMs: number;
}

interface ReconnectPlayerOptions {
  nowMs: number;
  expectedPlayerId?: string;
}

interface CompleteRoomOptions {
  recordedAt: number;
  commitLatencyMs?: number;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  commitFailedTerminal?: boolean;
  failureAcknowledged?: boolean;
}

interface MarkResultsFailedTerminalOptions {
  nowMs?: number;
  elapsedMs?: number;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  failureAcknowledged?: boolean;
}

type UxFlowStateId =
  | "TS-CONNECT-FAILED"
  | "PM-LOBBY-STATUS"
  | "PM-COUNTDOWN"
  | "HUD-ACTIVE"
  | "HUD-RECONNECTING"
  | "HUD-ELIMINATED"
  | "PO-LEADERBOARD-FINAL";

type CountdownInterruptionState = "paused" | "resumed" | "cancelled";

type CountdownInterruptionReason = "player_disconnected" | "player_reconnected" | "min_ready_not_met";

interface PreMatchReadyPlayerContract {
  playerId: string;
  ready: boolean;
  connected: boolean;
}

interface PreMatchReadinessContract {
  minReadyThreshold: number;
  readyCount: number;
  thresholdSatisfied: boolean;
  players: PreMatchReadyPlayerContract[];
}

interface CountdownInterruptionContract {
  state: CountdownInterruptionState;
  reason: CountdownInterruptionReason;
  pauseCapMs: number;
  pauseRemainingMs?: number;
  interruptedByPlayerId?: string;
}

interface ReconnectTimeoutContract {
  budgetMs: number;
  remainingMs: number;
  expiresAtMs: number;
  terminalReason?: "token_expired";
}

interface OnboardingCueRuntimeContract {
  id: Wis215FirstSessionOnboardingCueId;
  title: string;
  body: string;
  ctaLabel: "Got it";
  dismissible: true;
  nonBlocking: true;
}

interface FirstSessionOnboardingRuntimeContract {
  cueOrder: readonly Wis215FirstSessionOnboardingCueId[];
  byPlayerId: Record<string, OnboardingCueRuntimeContract | null>;
}

interface UxFlowStateContract {
  id: UxFlowStateId;
  reason: string;
  reconnectReason?: ReconnectResult["reason"] | "connected";
  reconnectTimeout?: ReconnectTimeoutContract;
  eliminationCause?: PlayerSnapshot["eliminationReason"];
  risingGround?: RisingGroundUxContract;
  countdownSeconds?: number;
  readiness?: PreMatchReadinessContract;
  countdownInterruption?: CountdownInterruptionContract;
  queueTimeoutFallback?: QueueTimeoutFallbackPayload;
  onboarding?: FirstSessionOnboardingRuntimeContract;
}

interface HudFieldContract<TValue> {
  label: string;
  value: TValue;
}

interface HudPlayerViewModel {
  rank: HudFieldContract<string>;
  score: HudFieldContract<number>;
  survivalTime: HudFieldContract<string>;
  groundSpeed: HudFieldContract<string>;
  playersLeft: HudFieldContract<string>;
}

interface HudViewModel {
  cadence: {
    rank: "4Hz";
    score: "4Hz";
    survivalTime: "1Hz";
    groundSpeed: "event";
    playersLeft: "4Hz";
  };
  byPlayerId: Record<string, HudPlayerViewModel>;
}

interface RealtimeLeaderboardSnapshotEntry {
  playerId: string;
  rank: number;
  score: number;
  survivalMs: number;
  connected: boolean;
  isEliminated: boolean;
  eliminationReason: PlayerSnapshot["eliminationReason"];
  isTie: boolean;
  placementToken: string;
}

interface RealtimeLeaderboardIncrementalUpdate {
  playerId: string;
  kind: "joined" | "left" | "updated";
  previousRank: number | null;
  rank: number | null;
  rankDelta: number | null;
  previousScore: number | null;
  score: number | null;
  scoreDelta: number | null;
  previousSurvivalMs: number | null;
  survivalMs: number | null;
  survivalDeltaMs: number | null;
  changedFields: Array<
    | "rank"
    | "score"
    | "survivalMs"
    | "connected"
    | "isEliminated"
    | "eliminationReason"
    | "isTie"
    | "placementToken"
  >;
}

interface RealtimeLeaderboardProjection {
  revision: number;
  tick: number;
  snapshot: RealtimeLeaderboardSnapshotEntry[];
  updates: RealtimeLeaderboardIncrementalUpdate[];
}

type ResultsLifecycleState = "RESULTS-NORMAL" | "RESULTS-PENDING" | "RESULTS-RETRYING" | "RESULTS-FAILED";

interface ResultsRecoveryTransition {
  stateId: "TS-SERVICE-RECOVERED";
  reason: "leaderboard_commit_succeeded_after_retry_or_failure";
  copyKey: "results.recovered.toast";
  toastDurationMs: number;
  clearsSyncPendingChip: true;
}

interface ResultsCommitLifecycle {
  state: ResultsLifecycleState;
  copyKey:
    | "results.normal.final_placement"
    | "results.pending.saving"
    | "results.retrying.active"
    | "results.retrying.delayed"
    | "results.failed.terminal";
  elapsedMs: number;
  attempt: number | null;
  maxAttempts: number | null;
  delayedVariant: boolean;
  acknowledgementRequired: boolean;
  acknowledged: boolean;
  rematchEnabled: boolean;
  syncPendingChip: boolean;
  recoveredTransition: ResultsRecoveryTransition | null;
}

interface RisingGroundUxContract {
  state: Wis135RisingGroundRuntimeState;
  copy: string;
  causeCopy?: string;
  helperCopy?: string;
  actions?: ReadonlyArray<string>;
  dangerTier: Wis135RisingGroundDangerTier;
  groundSpeedMultiplier: number;
  clearancePct: number | null;
  enteredAtMs: number;
  timingMs: {
    warningMinDwell: number;
    criticalMinDwell: number;
    eliminationImpact: number;
    eliminationAutoRoute: number;
    sameTierDebounce: number;
  };
  visibility: {
    desktop: string;
    mobile: string;
  };
  rankToastSuppressed: boolean;
  gameplayInputLocked: boolean;
}

interface RisingGroundCandidate {
  state: Wis135RisingGroundRuntimeState;
  playerId: string;
  dangerTier: Wis135RisingGroundDangerTier;
  groundSpeedMultiplier: number;
  clearancePct: number | null;
}

const ELIM_IMPACT_DURATION_MS = WIS214_GAME_OVER_TIMING_MS.eliminationImpact;
const ELIM_ACTIONS_TIMEOUT_MS = WIS214_GAME_OVER_TIMING_MS.eliminationActionsTimeout;

type EliminationTransitionState =
  | "ELIM-IMPACT"
  | "ELIM-ACTIONS"
  | "ELIM-MANUAL-RESULTS"
  | "ELIM-SPECTATOR"
  | "ELIM-AUTO-RESULTS";

type EliminationActionId = "VIEW_RESULTS" | "VIEW_LEADERBOARD" | "SPECTATE";

interface EliminationActionCta {
  id: EliminationActionId;
  label: "View Results" | "View Leaderboard" | "Spectate";
  routeTarget: "results_screen" | "spectator_mode";
  style: "primary" | "secondary";
  outcomeCopy: string;
}

interface EliminationAutoRoute {
  actionId: "VIEW_RESULTS" | "VIEW_LEADERBOARD";
  routeTarget: "results_screen";
  reason: "inactivity_timeout";
  selectedAtMs: number;
}

interface EliminationSelectedRoute {
  actionId: EliminationActionId;
  routeTarget: "results_screen" | "spectator_mode";
  reason: "player_selected" | "inactivity_timeout";
  selectedAtMs: number;
}

interface EliminationTransitionContract {
  state: EliminationTransitionState;
  eliminationCause: PlayerSnapshot["eliminationReason"];
  enteredAtMs: number;
  elapsedMs: number;
  impactDurationMs: number;
  actionsTimeoutMs: number;
  autoRouteAtMs: number;
  autoRouteTarget: "results_screen";
  headlineCopy: string;
  helperCopy: string;
  autoRouteCopy: string;
  actionCtas: EliminationActionCta[];
  route: EliminationSelectedRoute | null;
}

type PostMatchActionId = "REPLAY_MATCH" | "BACK_TO_LOBBY" | "EXIT_TO_MENU";

type PostMatchRouteTarget = "pre_match.ready_check" | "pre_match.lobby_ready" | "shell.main_menu";

interface PostMatchActionContract {
  id: PostMatchActionId;
  label: "Replay Match" | "Back to Lobby" | "Exit to Menu";
  routeTarget: PostMatchRouteTarget;
  style: "primary" | "secondary";
  outcomeCopy: string;
}

interface PostMatchActionSelection {
  actionId: PostMatchActionId;
  label: "Replay Match" | "Back to Lobby" | "Exit to Menu";
  routeTarget: PostMatchRouteTarget;
  reason: "player_selected";
  selectedAtMs: number;
  outcomeCopy: string;
}

interface PostMatchActionBlockedSelection {
  actionId: PostMatchActionId;
  label: "Replay Match" | "Back to Lobby" | "Exit to Menu";
  routeTarget: PostMatchRouteTarget;
  reason: "results_failure_ack_required";
  selectedAtMs: number;
  blocked: true;
  resultsLifecycleState: "RESULTS-FAILED";
  acknowledgementRequired: true;
  acknowledged: false;
  rematchEnabled: false;
  copyKey: "results.failed.terminal";
  guidanceCopy: string;
}

export type PostMatchActionAttempt = PostMatchActionSelection | PostMatchActionBlockedSelection;

interface PostMatchActionsContract {
  available: PostMatchActionContract[];
  guidanceCopy: string;
  routeState: "idle" | "route_pending";
  selected: PostMatchActionSelection | null;
}

interface AccessibilityFocusOrderContract {
  eliminationActions: readonly string[] | null;
  resultsActions: readonly string[] | null;
  resultsFailureAlert: readonly string[] | null;
}

interface AccessibilityRuntimeContract {
  baseline: typeof WIS216_ACCESSIBILITY_BASELINE;
  hudAnnouncement: Wis216LiveRegionPolicy;
  resultsAnnouncement: Wis216LiveRegionPolicy;
  recoveryToastAnnouncement: Wis216LiveRegionPolicy | null;
  focusOrder: AccessibilityFocusOrderContract;
}

interface FlowParityMetadata {
  specVersion: "1.0.0";
  sourceIssue: "WIS-73";
  fixturePath: "docs/multiplayer-state-ux-acceptance.fixture.json";
}

interface FlowStateBase {
  sessionId: string;
  revision: number;
  updatedAt: number;
  parityMetadata: FlowParityMetadata;
  world: WorldSnapshot;
  players: PlayerSnapshot[];
  uxState: UxFlowStateContract;
  hud: HudViewModel;
  leaderboard?: RealtimeLeaderboardProjection;
  eliminationTransition?: EliminationTransitionContract;
  accessibility?: AccessibilityRuntimeContract;
}

export interface LobbyFlowState extends FlowStateBase {
  phase: "lobby";
}

export interface InRoundFlowState extends FlowStateBase {
  phase: "in_round";
}

export interface ResultsFlowState extends FlowStateBase {
  phase: "results";
  completedAt: number;
  standings: RecordMatchResultOutput["standings"];
  commits: RecordMatchResultOutput["commits"];
  resultsLifecycle: ResultsCommitLifecycle;
  postMatchActions: PostMatchActionsContract;
}

export type RoomFlowState = LobbyFlowState | InRoundFlowState | ResultsFlowState;

export interface SyncAnchor {
  revision: number;
  tick: number;
  stateHash: string;
}

export interface SyncDesyncTelemetry {
  sessionId: string;
  playerId: string | null;
  action: "input" | "disconnect" | "reconnect" | "advance" | "complete";
  reason: "revision_mismatch" | "state_hash_mismatch" | "tick_mismatch";
  receivedRevision: number;
  authoritativeRevision: number;
  receivedTick: number;
  authoritativeTick: number;
  receivedStateHash: string;
  authoritativeStateHash: string;
  tickDelta: number;
  maxAllowedTickDelta: number;
  detectedAt: number;
}

export interface IntegrityViolationTelemetry {
  sessionId: string;
  playerId: string | null;
  ruleId: string;
  category: IntegrityCategory;
  severity: IntegritySeverity;
  action: IntegrityAction;
  tick: number;
  revision: number;
  detectedAt: number;
  threshold: number | null;
  windowCount: number;
  evidence: Record<string, unknown>;
}

export interface IntegrityEscalationTelemetry {
  sessionId: string;
  playerId: string | null;
  fromSeverity: IntegritySeverity;
  toSeverity: IntegritySeverity;
  triggerRuleId: string;
  windowStartMs: number;
  windowEndMs: number;
  violationCount: number;
  escalatedAt: number;
}

export interface RecordIntegrityViolationInput {
  playerId: string | null;
  ruleId: string;
  category: IntegrityCategory;
  severity: IntegritySeverity;
  action: IntegrityAction;
  threshold: number | null;
  evidence: Record<string, unknown>;
  detectedAt: number;
}

export interface OnboardingCueAckResult {
  acknowledged: true;
  alreadyAcknowledged: boolean;
  playerId: string;
  cueId: Wis215FirstSessionOnboardingCueId;
}

interface OnboardingFunnelTelemetryState {
  startedAtMs: number | null;
  startCueId: Wis215FirstSessionOnboardingCueId | null;
  completedAtMs: number | null;
  quitBeforeFirstFullRoundAtMs: number | null;
}

interface ManagedRoom {
  session: MultiplayerSession | null;
  flowState: RoomFlowState;
  reconnectWindowMs: number;
  lastAdvanceAtMs: number;
  tickLagWindow: RollingWindow;
  reconnectSlo: {
    attempts: number;
    successes: number;
    reasonBreakdown: {
      connected: number;
      unknown_token: number;
      token_expired: number;
      token_replayed: number;
    };
  };
  eliminationTransitionState: {
    startedAtMs: number;
    eliminationCause: PlayerSnapshot["eliminationReason"];
    selectedRoute: EliminationSelectedRoute | null;
  } | null;
  risingGround: {
    baselineGroundSpeed: number;
    state: Wis135RisingGroundRuntimeState | null;
    enteredAtMs: number;
    playerId: string | null;
    dangerTier: Wis135RisingGroundDangerTier | null;
    clearancePct: number | null;
    groundSpeedMultiplier: number;
    eliminationTriggeredAtMs: number | null;
    actionsShownAtMs: number | null;
    autoRouteEmitted: boolean;
  };
  preMatch: {
    minReadyThreshold: number;
    readyByPlayerId: Map<string, boolean>;
    countdown: {
      status: "idle" | "active" | "paused";
      pauseExpiresAtMs: number | null;
      interruptedByPlayerId: string | null;
    };
  };
  onboarding: {
    acknowledgedByPlayerId: Map<string, Set<Wis215FirstSessionOnboardingCueId>>;
    funnelByPlayerId: Map<string, OnboardingFunnelTelemetryState>;
    firstFullRoundCompletedAtMs: number | null;
  };
  integrity: {
    freezeRankings: boolean;
    inputControlByPlayerId: Map<
      string,
      {
        throttleUntilMs: number;
        quarantined: boolean;
      }
    >;
    pendingResyncByPlayerId: Set<string>;
    tickLagBreachSinceMs: {
      warn: number | null;
      critical: number | null;
      page: number | null;
    };
  };
}

const FLOW_PARITY_METADATA: FlowParityMetadata = {
  specVersion: "1.0.0",
  sourceIssue: "WIS-73",
  fixturePath: "docs/multiplayer-state-ux-acceptance.fixture.json",
};

const PRE_MATCH_MIN_READY_THRESHOLD = 2;
const PRE_MATCH_COUNTDOWN_SECONDS = 3;
const PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS = 5_000;
const RESULTS_RECOVERY_TOAST_DURATION_MS = 4_000;

export class SessionManager {
  private readonly eventSink: InMemoryEventSink;

  private readonly leaderboard: LeaderboardService;

  private readonly durableStore?: DurableStateStore;

  private readonly integrityConfig: SessionIntegrityConfig;

  private readonly rooms = new Map<string, ManagedRoom>();

  private readonly realtimeLeaderboardBySession = new Map<string, RealtimeLeaderboardProjection>();

  private readonly integrityWindowsByKey = new Map<string, number[]>();

  private readonly integrityEscalationByKey = new Map<string, IntegritySeverity>();

  constructor(options: SessionManagerOptions) {
    this.eventSink = options.eventSink;
    this.leaderboard = options.leaderboard;
    this.durableStore = options.durableStore;
    this.integrityConfig = resolveSessionIntegrityConfig(options.integrityConfig);
  }

  createRoom(input: CreateRoomInput): { sessionId: string } {
    if (this.rooms.has(input.sessionId)) {
      throw new Error(`Session ${input.sessionId} already exists`);
    }

    const session = new MultiplayerSession({
      sessionId: input.sessionId,
      maxPlayers: input.maxPlayers,
      reconnectGraceMs: input.reconnectGraceMs,
      reconnectTokenSecret: input.reconnectTokenSecret,
      reconnectTokenReplayRetentionMs: input.reconnectTokenReplayRetentionMs,
      playerInputRateLimitPerSecond: input.playerInputRateLimitPerSecond,
      roomInputRateLimitPerSecond: input.roomInputRateLimitPerSecond,
      inputRateWindowMs: input.inputRateWindowMs,
      integrityConfig: this.integrityConfig,
    });
    const snapshot = session.getSnapshot();
    const preMatch = this.createPreMatchState();
    const readiness = this.buildPreMatchReadiness(preMatch, snapshot);
    const flowState: LobbyFlowState = {
      phase: "lobby",
      sessionId: input.sessionId,
      revision: 1,
      updatedAt: input.nowMs,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: snapshot.world,
      players: snapshot.players,
      uxState: {
        id: "PM-LOBBY-STATUS",
        reason: "created",
        readiness,
      },
      hud: this.buildHudViewModel(snapshot),
    };

    const room: ManagedRoom = {
      session,
      flowState,
      reconnectWindowMs: input.reconnectGraceMs ?? 30_000,
      lastAdvanceAtMs: input.nowMs,
      tickLagWindow: new RollingWindow(),
      reconnectSlo: {
        attempts: 0,
        successes: 0,
        reasonBreakdown: {
          connected: 0,
          unknown_token: 0,
          token_expired: 0,
          token_replayed: 0,
        },
      },
      eliminationTransitionState: null,
      risingGround: {
        baselineGroundSpeed: Math.max(0.001, snapshot.world.groundRiseSpeed),
        state: null,
        enteredAtMs: input.nowMs,
        playerId: null,
        dangerTier: null,
        clearancePct: null,
        groundSpeedMultiplier: 1,
        eliminationTriggeredAtMs: null,
        actionsShownAtMs: null,
        autoRouteEmitted: false,
      },
      preMatch,
      onboarding: {
        acknowledgedByPlayerId: new Map(),
        funnelByPlayerId: new Map(),
        firstFullRoundCompletedAtMs: null,
      },
      integrity: {
        freezeRankings: false,
        inputControlByPlayerId: new Map(),
        pendingResyncByPlayerId: new Set(),
        tickLagBreachSinceMs: {
          warn: null,
          critical: null,
          page: null,
        },
      },
    };
    this.rooms.set(input.sessionId, room);

    this.eventSink.emit("session.lifecycle.created", {
      sessionId: input.sessionId,
      nowMs: input.nowMs,
    });
    this.emitFlowStateUpdated(room, flowState, "created");
    this.persistFlowState(flowState, "created");

    return { sessionId: input.sessionId };
  }

  joinRoom(sessionId: string, playerId: string, options: JoinRoomOptions): void {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "lobby") {
      throw new Error(`Session ${sessionId} is no longer in lobby`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const recoveredFromTransportFailure = room.flowState.uxState.id === "TS-CONNECT-FAILED";
    session.joinPlayer(playerId, options);

    const snapshot = session.getSnapshot();
    room.preMatch.readyByPlayerId.set(playerId, false);
    const lobbyUxState = this.resolveLobbyUxState(
      room,
      snapshot,
      options.nowMs,
      recoveredFromTransportFailure ? "transport_connected" : "player_joined",
      playerId,
    );
    const flowState: LobbyFlowState = {
      phase: "lobby",
      sessionId,
      revision: room.flowState.revision + 1,
      updatedAt: options.nowMs,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: snapshot.world,
      players: snapshot.players,
      uxState: lobbyUxState,
      hud: this.buildHudViewModel(snapshot),
    };
    room.flowState = flowState;

    this.eventSink.emit("session.lifecycle.player_joined", {
      sessionId,
      playerId,
      nowMs: options.nowMs,
    });
    this.emitFlowStateUpdated(room, flowState, "player_joined");
    this.persistFlowState(flowState, "player_joined");
  }

  setPlayerReady(sessionId: string, playerId: string, ready: boolean, nowMs = Date.now()): void {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "lobby") {
      throw new Error(`Session ${sessionId} is no longer in lobby`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const snapshot = session.getSnapshot();
    if (!snapshot.players.some((player) => player.playerId === playerId)) {
      throw new Error(`Player ${playerId} not found in session ${sessionId}`);
    }

    room.preMatch.readyByPlayerId.set(playerId, ready);
    const updatedSnapshot = session.getSnapshot();
    const flowState: LobbyFlowState = {
      phase: "lobby",
      sessionId,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: updatedSnapshot.world,
      players: updatedSnapshot.players,
      uxState: this.resolveLobbyUxState(room, updatedSnapshot, nowMs, "player_ready_changed", playerId),
      hud: this.buildHudViewModel(updatedSnapshot),
    };
    room.flowState = flowState;

    this.eventSink.emit("session.lifecycle.player_ready_changed", {
      sessionId,
      playerId,
      ready,
      nowMs,
    });
    this.emitFlowStateUpdated(room, flowState, "player_ready_changed");
    this.persistFlowState(flowState, "player_ready_changed");
  }

  markTransportConnectFailed(sessionId: string, nowMs = Date.now()): void {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "lobby") {
      throw new Error(`Session ${sessionId} is no longer in lobby`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const snapshot = session.getSnapshot();
    this.syncPreMatchReadiness(room.preMatch, snapshot);
    const readiness = this.buildPreMatchReadiness(room.preMatch, snapshot);
    room.preMatch.countdown.status = "idle";
    room.preMatch.countdown.pauseExpiresAtMs = null;
    room.preMatch.countdown.interruptedByPlayerId = null;
    const fallback = createQueueTimeoutFallback();
    const flowState: LobbyFlowState = {
      phase: "lobby",
      sessionId,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: snapshot.world,
      players: snapshot.players,
      uxState: {
        id: "TS-CONNECT-FAILED",
        reason: "transport_connect_failed",
        readiness,
        queueTimeoutFallback: {
          title: fallback.title,
          body: fallback.body,
          primaryCta: fallback.primaryCta,
          secondaryCta: fallback.secondaryCta,
        },
      },
      hud: this.buildHudViewModel(snapshot),
    };

    room.flowState = flowState;
    this.eventSink.emit("session.lifecycle.transport_connect_failed", {
      sessionId,
      nowMs,
    });
    this.emitFlowStateUpdated(room, flowState, "transport_connect_failed");
    this.persistFlowState(flowState, "transport_connect_failed");
  }

  submitInput(sessionId: string, playerId: string, input: PlayerInput, nowMs = Date.now()): SubmitInputResult {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase === "results") {
      throw new Error(`Session ${sessionId} already completed`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const inputControl = this.getOrCreateInputControl(room, playerId);
    const enforcedQuarantine = inputControl.quarantined;
    const enforcedThrottle = !enforcedQuarantine && inputControl.throttleUntilMs > nowMs;
    const result =
      enforcedQuarantine || enforcedThrottle
        ? ({
            accepted: false,
            reason: "rate_limited_player",
          } as const)
        : session.submitInput(playerId, input, nowMs);

    this.eventSink.emit(result.accepted ? "session.input.accepted" : "session.input.rejected", {
      sessionId,
      playerId,
      sequence: input.sequence,
      result,
    });

    if (!result.accepted && (result.reason === "rate_limited_player" || result.reason === "rate_limited_room")) {
      this.eventSink.emit("session.input.rate_limited", {
        sessionId,
        playerId,
        sequence: input.sequence,
        scope: result.reason === "rate_limited_player" ? "player" : "room",
        nowMs,
      });
    }

    if (!result.accepted) {
      const ruleId =
        result.reason === "impossible_input"
          ? INTEGRITY_RULE_IDS.impossibleInputEnvelope
          : result.reason === "out_of_order"
            ? INTEGRITY_RULE_IDS.impossibleInputOutOfOrder
            : result.reason === "stale"
              ? INTEGRITY_RULE_IDS.impossibleInputStale
              : result.reason === "rate_limited_player" || result.reason === "rate_limited_room"
                ? INTEGRITY_RULE_IDS.impossibleInputBurst
                : null;

      if (ruleId) {
        const violation = this.recordIntegrityViolationWithRoom(
          room,
          {
            playerId,
            ruleId,
            category: "input",
            severity: "warn",
            action:
              enforcedQuarantine
                ? "quarantine_player"
                : result.reason === "rate_limited_room"
                ? "quarantine_session"
                : result.reason === "rate_limited_player"
                  ? "reject_input"
                  : "reject_input",
            threshold: this.thresholdForRule(ruleId),
            evidence: {
              reason: result.reason,
              sequence: input.sequence,
              thrust: input.thrust,
              enforcedThrottle,
              enforcedQuarantine,
              throttleUntilMs: inputControl.throttleUntilMs,
            },
            detectedAt: nowMs,
          },
          {
            tick: room.flowState.world.tick,
            revision: room.flowState.revision,
          },
        );
        this.applyInputEscalationPolicy(room, playerId, nowMs, violation);
      }
    }

    return result;
  }

  advanceRoom(sessionId: string, deltaMs: number, nowMs = Date.now()): void {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase === "results") {
      throw new Error(`Session ${sessionId} already completed`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const expiredReconnects = session.resolveExpiredReconnects(nowMs);
    for (const expired of expiredReconnects) {
      this.eventSink.emit("session.lifecycle.reconnect_expired", {
        sessionId,
        playerId: expired.playerId,
        expiredAtMs: expired.expiredAtMs,
        nowMs,
      });
      this.emitOnboardingQuitBeforeFirstFullRound(room, sessionId, expired.playerId, nowMs, "reconnect_expired");
    }

    const snapshot = session.tick(deltaMs);
    const nextRevision = room.flowState.revision + 1;
    const runtimeIntegrityViolations = session.drainIntegrityViolations();
    for (const violation of runtimeIntegrityViolations) {
      this.recordIntegrityViolationWithRoom(
        room,
        {
          playerId: violation.playerId,
          ruleId: violation.ruleId,
          category: violation.category,
          severity: violation.severity,
          action: violation.action,
          threshold: violation.threshold,
          evidence: violation.evidence,
          detectedAt: violation.detectedAt,
        },
        {
          tick: snapshot.world.tick,
          revision: nextRevision,
        },
      );
    }

    const inRoundContracts = this.resolveInRoundContracts(room, snapshot, "tick", nowMs);
    const flowState: InRoundFlowState = {
      phase: "in_round",
      sessionId,
      revision: nextRevision,
      updatedAt: nowMs,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: snapshot.world,
      players: snapshot.players,
      uxState: inRoundContracts.uxState,
      hud: this.buildHudViewModel(snapshot),
      eliminationTransition: inRoundContracts.eliminationTransition,
    };
    room.flowState = flowState;

    this.eventSink.emit("session.lifecycle.tick", {
      sessionId,
      tick: snapshot.world.tick,
      groundHeight: snapshot.world.groundHeight,
      stateHash: snapshot.world.stateHash,
    });

    const lagMs = this.computeTickLagMs(room, deltaMs, nowMs);
    room.tickLagWindow.push(lagMs);
    const p95LagMs = roundMetric(room.tickLagWindow.percentile(95));
    const p99LagMs = roundMetric(room.tickLagWindow.percentile(99));
    this.eventSink.emit("session.slo.tick_lag", {
      sessionId,
      tick: snapshot.world.tick,
      targetDeltaMs: deltaMs,
      lagMs,
      p95LagMs,
      p99LagMs,
      sampleSize: room.tickLagWindow.size,
      measuredAt: nowMs,
    });

    const tickDurationMs = Math.max(1, deltaMs);
    const p95LagTicks = roundMetric(p95LagMs / tickDurationMs);
    const p99LagTicks = roundMetric(p99LagMs / tickDurationMs);
    const lagTicks = roundMetric(lagMs / tickDurationMs);
    let tickLagSeverity: IntegritySeverity | null = null;
    let tickLagThresholdTicks: number | null = null;
    let tickLagWindowMs: number | null = null;

    if (this.integrityConfig.enableTickLagEscalation) {
      const breach = room.integrity.tickLagBreachSinceMs;
      breach.warn =
        p95LagTicks > this.integrityConfig.tickLagWarnP95Ticks ? (breach.warn ?? nowMs) : null;
      breach.critical =
        p95LagTicks > this.integrityConfig.tickLagCriticalP95Ticks ? (breach.critical ?? nowMs) : null;
      breach.page = lagTicks > this.integrityConfig.tickLagPageTicks ? (breach.page ?? nowMs) : null;

      if (breach.page !== null && nowMs - breach.page >= this.integrityConfig.tickLagPageWindowMs) {
        tickLagSeverity = "critical";
        tickLagThresholdTicks = this.integrityConfig.tickLagPageTicks;
        tickLagWindowMs = this.integrityConfig.tickLagPageWindowMs;
      } else if (
        breach.critical !== null &&
        nowMs - breach.critical >= this.integrityConfig.tickLagCriticalWindowMs
      ) {
        tickLagSeverity = "critical";
        tickLagThresholdTicks = this.integrityConfig.tickLagCriticalP95Ticks;
        tickLagWindowMs = this.integrityConfig.tickLagCriticalWindowMs;
      } else if (breach.warn !== null && nowMs - breach.warn >= this.integrityConfig.tickLagWarnWindowMs) {
        tickLagSeverity = "warn";
        tickLagThresholdTicks = this.integrityConfig.tickLagWarnP95Ticks;
        tickLagWindowMs = this.integrityConfig.tickLagWarnWindowMs;
      }
    }

    if (tickLagSeverity) {
      this.recordIntegrityViolationWithRoom(
        room,
        {
          playerId: null,
          ruleId: INTEGRITY_RULE_IDS.timeDriftTickLag,
          category: "time_drift",
          severity: tickLagSeverity,
          action: "observe_only",
          threshold: tickLagThresholdTicks,
          evidence: {
            lagMs,
            p95LagMs,
            p99LagMs,
            lagTicks,
            p95LagTicks,
            p99LagTicks,
            sampleSize: room.tickLagWindow.size,
            tickDurationMs,
            breachWindowMs: tickLagWindowMs,
          },
          detectedAt: nowMs,
        },
        {
          tick: snapshot.world.tick,
          revision: nextRevision,
        },
      );
    }

    room.lastAdvanceAtMs = nowMs;

    this.emitFlowStateUpdated(room, flowState, "tick");
    this.persistFlowState(flowState, "tick");
  }

  disconnectPlayer(sessionId: string, playerId: string, options: DisconnectPlayerOptions): DisconnectResult {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase === "results") {
      throw new Error(`Session ${sessionId} already completed`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const disconnected = session.disconnectPlayer(playerId, options.nowMs);
    const snapshot = session.getSnapshot();
    if (room.flowState.phase === "lobby") {
      const flowState: LobbyFlowState = {
        phase: "lobby",
        sessionId,
        revision: room.flowState.revision + 1,
        updatedAt: options.nowMs,
        parityMetadata: { ...FLOW_PARITY_METADATA },
        world: snapshot.world,
        players: snapshot.players,
        uxState: this.resolveLobbyUxState(room, snapshot, options.nowMs, "player_disconnected", playerId),
        hud: this.buildHudViewModel(snapshot),
      };
      room.flowState = flowState;
    } else {
      const reconnectTimeout = this.resolveReconnectTimeoutContract(room, snapshot, options.nowMs);
      room.flowState = {
        ...room.flowState,
        revision: room.flowState.revision + 1,
        updatedAt: options.nowMs,
        world: snapshot.world,
        players: snapshot.players,
        uxState: {
          id: "HUD-RECONNECTING",
          reason: "player_disconnected",
          reconnectTimeout,
        },
        hud: this.buildHudViewModel(snapshot),
      } as RoomFlowState;
    }

    this.eventSink.emit("session.lifecycle.player_disconnected", {
      sessionId,
      playerId,
      nowMs: options.nowMs,
      reconnectExpiresAtMs: disconnected.expiresAtMs,
    });
    this.emitFlowStateUpdated(room, room.flowState, "player_disconnected");
    this.persistFlowState(room.flowState, "player_disconnected");

    return disconnected;
  }

  reconnectPlayer(sessionId: string, resumeToken: string, options: ReconnectPlayerOptions): ReconnectResult {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase === "results") {
      throw new Error(`Session ${sessionId} already completed`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const reconnect = session.reconnectPlayer(resumeToken, options.nowMs, options.expectedPlayerId);
    const snapshot = session.getSnapshot();
    if (room.flowState.phase === "lobby") {
      const flowState: LobbyFlowState = {
        phase: "lobby",
        sessionId,
        revision: room.flowState.revision + 1,
        updatedAt: options.nowMs,
        parityMetadata: { ...FLOW_PARITY_METADATA },
        world: snapshot.world,
        players: snapshot.players,
        uxState: this.resolveLobbyUxState(
          room,
          snapshot,
          options.nowMs,
          reconnect.connected ? "player_reconnected" : "player_reconnect_failed",
          reconnect.playerId,
        ),
        hud: this.buildHudViewModel(snapshot),
      };
      room.flowState = flowState;
    } else {
      const reconnectReason = reconnect.connected
        ? undefined
        : reconnect.reason;
      const inRoundContracts = this.resolveInRoundContracts(
        room,
        snapshot,
        reconnect.connected
          ? "player_reconnected"
          : reconnect.reason === "token_expired"
            ? "player_reconnect_timeout"
            : "player_reconnect_failed",
        options.nowMs,
        reconnectReason,
      );

      room.flowState = {
        ...room.flowState,
        revision: room.flowState.revision + 1,
        updatedAt: options.nowMs,
        world: snapshot.world,
        players: snapshot.players,
        uxState: inRoundContracts.uxState,
        hud: this.buildHudViewModel(snapshot),
        eliminationTransition: inRoundContracts.eliminationTransition,
      } as RoomFlowState;
    }

    this.eventSink.emit("session.lifecycle.player_reconnect_attempt", {
      sessionId,
      nowMs: options.nowMs,
      connected: reconnect.connected,
      playerId: reconnect.playerId ?? null,
      reason: reconnect.reason ?? null,
    });
    this.emitReconnectSlo(room, sessionId, reconnect, options.nowMs);
    this.emitFlowStateUpdated(
      room,
      room.flowState,
      reconnect.connected ? "player_reconnected" : "player_reconnect_failed",
    );
    this.persistFlowState(
      room.flowState,
      reconnect.connected ? "player_reconnected" : "player_reconnect_failed",
    );

    return reconnect;
  }

  completeRoom(sessionId: string, options: CompleteRoomOptions): RecordMatchResultOutput {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase === "results") {
      throw new Error(`Session ${sessionId} already completed`);
    }
    if (room.integrity.freezeRankings) {
      throw new Error(`Session ${sessionId} requires authoritative resync checkpoint before completion`);
    }

    const session = this.requireLiveSession(room, sessionId);
    const snapshot = session.getSnapshot();

    const entries = snapshot.players.map((player) => ({
      playerId: player.playerId,
      score: computeAuthoritativeScore(player),
      survivalMs: player.survivalMs,
    }));

    const result = this.leaderboard.recordMatchResult({
      eventId: this.getMatchFinalEventId(sessionId),
      sessionId,
      recordedAt: options.recordedAt,
      entries,
    });

    room.session = null;
    room.eliminationTransitionState = null;
    const flowState: ResultsFlowState = {
      phase: "results",
      sessionId,
      revision: room.flowState.revision + 1,
      updatedAt: options.recordedAt,
      parityMetadata: { ...FLOW_PARITY_METADATA },
      world: snapshot.world,
      players: snapshot.players,
      uxState: {
        id: "PO-LEADERBOARD-FINAL",
        reason: "completed",
      },
      hud: this.buildHudViewModel(snapshot),
      completedAt: options.recordedAt,
      standings: result.standings,
      commits: result.commits,
      resultsLifecycle: this.buildResultsLifecycle(options),
      postMatchActions: this.buildPostMatchActions(),
    };
    room.flowState = flowState;
    room.onboarding.firstFullRoundCompletedAtMs = options.recordedAt;

    this.eventSink.emit("session.lifecycle.completed", {
      sessionId,
      players: entries.length,
      recordedAt: options.recordedAt,
    });
    this.emitFlowStateUpdated(room, flowState, "completed");
    this.persistFlowState(flowState, "completed");

    return result;
  }

  getFlowState(sessionId: string): RoomFlowState {
    const room = this.requireRoom(sessionId);
    this.syncOnboardingAcknowledgements(room, room.flowState.players);

    const flowState = structuredClone(room.flowState);
    flowState.uxState = {
      ...flowState.uxState,
      onboarding: this.buildFirstSessionOnboardingRuntimeContract(room, flowState),
    };
    flowState.leaderboard = structuredClone(this.getRealtimeLeaderboardProjection(flowState));
    flowState.accessibility = this.buildAccessibilityContract(flowState);

    return flowState;
  }

  private buildAccessibilityContract(state: RoomFlowState): AccessibilityRuntimeContract {
    const hudAnnouncement = resolveWis216AnnouncementPolicy({
      uxStateId: state.uxState.id,
      risingGroundState: state.uxState.risingGround?.state,
    });

    const eliminationActions =
      state.phase === "in_round" && state.eliminationTransition?.state === "ELIM-ACTIONS"
        ? [
            "elimination_heading",
            state.eliminationTransition.actionCtas.find((cta) => cta.style === "primary")?.id ?? "primary_action",
            state.eliminationTransition.actionCtas.find((cta) => cta.style === "secondary")?.id ?? "secondary_action",
          ]
        : null;

    let resultsAnnouncement: Wis216LiveRegionPolicy = WIS216_ACCESSIBILITY_BASELINE.liveRegions.passive;
    let recoveryToastAnnouncement: Wis216LiveRegionPolicy | null = null;
    let resultsActions: readonly string[] | null = null;
    let resultsFailureAlert: readonly string[] | null = null;

    if (state.phase === "results") {
      resultsAnnouncement = resolveWis216AnnouncementPolicy({
        resultsLifecycleState: state.resultsLifecycle.state,
      });
      recoveryToastAnnouncement = state.resultsLifecycle.recoveredTransition
        ? resolveWis216AnnouncementPolicy({
            resultsLifecycleState: state.resultsLifecycle.state,
            hasRecoveryToast: true,
          })
        : null;

      const orderedActionIds = [...state.postMatchActions.available]
        .sort((left, right) => {
          if (left.style === right.style) {
            return 0;
          }
          return left.style === "primary" ? -1 : 1;
        })
        .map((action) => action.id);
      resultsActions = ["results_heading", ...orderedActionIds];

      if (state.resultsLifecycle.state === "RESULTS-FAILED") {
        resultsFailureAlert = [...WIS216_ACCESSIBILITY_BASELINE.focusOrder.resultsFailureAlert];
      }
    }

    return {
      baseline: WIS216_ACCESSIBILITY_BASELINE,
      hudAnnouncement,
      resultsAnnouncement,
      recoveryToastAnnouncement,
      focusOrder: {
        eliminationActions,
        resultsActions,
        resultsFailureAlert,
      },
    };
  }

  getSyncAnchor(sessionId: string): SyncAnchor {
    const room = this.requireRoom(sessionId);
    const state = room.flowState;

    return {
      revision: state.revision,
      tick: state.world.tick,
      stateHash: state.world.stateHash,
    };
  }

  acknowledgeResyncCheckpoint(sessionId: string, playerId: string, nowMs = Date.now()): boolean {
    const room = this.requireRoom(sessionId);
    if (!room.integrity.pendingResyncByPlayerId.has(playerId)) {
      return false;
    }

    room.integrity.pendingResyncByPlayerId.delete(playerId);
    const inputControl = this.getOrCreateInputControl(room, playerId);
    inputControl.quarantined = false;
    inputControl.throttleUntilMs = Math.max(inputControl.throttleUntilMs, nowMs);
    room.integrity.freezeRankings = room.integrity.pendingResyncByPlayerId.size > 0;

    this.eventSink.emit("session.integrity.resync_checkpoint", {
      sessionId,
      playerId,
      pendingPlayers: room.integrity.pendingResyncByPlayerId.size,
      freezeRankings: room.integrity.freezeRankings,
      acknowledgedAt: nowMs,
    });

    return true;
  }

  recordSyncDesync(payload: SyncDesyncTelemetry): void {
    this.eventSink.emit("session.sync.desync_detected", payload);

    if (!this.integrityConfig.enableDesyncEscalation || !payload.playerId) {
      return;
    }

    const room = this.rooms.get(payload.sessionId);
    if (!room) {
      return;
    }

    const violation = this.recordIntegrityViolationWithRoom(
      room,
      {
        playerId: payload.playerId,
        ruleId: INTEGRITY_RULE_IDS.timeDriftDesyncBurst,
        category: "time_drift",
        severity: "warn",
        action: "quarantine_player",
        threshold: this.integrityConfig.desyncEscalationCount,
        evidence: {
          reason: payload.reason,
          tickDelta: payload.tickDelta,
          maxAllowedTickDelta: payload.maxAllowedTickDelta,
          action: payload.action,
        },
        detectedAt: payload.detectedAt,
      },
      {
        tick: payload.authoritativeTick,
        revision: payload.authoritativeRevision,
      },
    );

    if (payload.playerId) {
      this.applyDesyncBurstPolicy(room, payload.playerId, payload.detectedAt, violation);
    }
  }

  recordIntegrityViolation(sessionId: string, input: RecordIntegrityViolationInput): void {
    const room = this.requireRoom(sessionId);
    this.recordIntegrityViolationWithRoom(room, input, {
      tick: room.flowState.world.tick,
      revision: room.flowState.revision,
    });
  }

  acknowledgeOnboardingCue(
    sessionId: string,
    playerId: string,
    cueId: string,
    nowMs = Date.now(),
  ): OnboardingCueAckResult {
    const room = this.requireRoom(sessionId);
    if (!isWis215FirstSessionOnboardingCueId(cueId)) {
      throw new Error(`Unknown onboarding cue ${cueId}`);
    }

    const playerExists = room.flowState.players.some((player) => player.playerId === playerId);
    if (!playerExists) {
      throw new Error(`Player ${playerId} not found in session ${sessionId}`);
    }

    this.syncOnboardingAcknowledgements(room, room.flowState.players);
    const acknowledged = room.onboarding.acknowledgedByPlayerId.get(playerId) ?? new Set();
    const funnel = this.getOnboardingFunnelTelemetryState(room, playerId);
    if (funnel.startedAtMs === null) {
      funnel.startedAtMs = nowMs;
      funnel.startCueId = cueId;
      this.eventSink.emit("session.onboarding.start", {
        sessionId,
        playerId,
        cueId,
        reason: "step_acknowledged",
        nowMs,
      });
    }

    const alreadyAcknowledged = acknowledged.has(cueId);
    if (!alreadyAcknowledged) {
      acknowledged.add(cueId);
      room.onboarding.acknowledgedByPlayerId.set(playerId, acknowledged);

      const totalSteps = WIS215_FIRST_SESSION_ONBOARDING_ORDER.length;
      const stepIndex = WIS215_FIRST_SESSION_ONBOARDING_ORDER.indexOf(cueId) + 1;
      this.eventSink.emit("session.onboarding.step_complete", {
        sessionId,
        playerId,
        cueId,
        stepIndex,
        completedSteps: acknowledged.size,
        totalSteps,
        nowMs,
      });

      if (acknowledged.size === totalSteps && funnel.completedAtMs === null) {
        funnel.completedAtMs = nowMs;
        this.eventSink.emit("session.onboarding.complete", {
          sessionId,
          playerId,
          completedSteps: acknowledged.size,
          totalSteps,
          startedAtMs: funnel.startedAtMs,
          durationMs: nowMs - (funnel.startedAtMs ?? nowMs),
          nowMs,
        });
      }
    }

    this.eventSink.emit("session.onboarding.cue_acknowledged", {
      sessionId,
      playerId,
      cueId,
      nowMs,
      alreadyAcknowledged,
    });

    return {
      acknowledged: true,
      alreadyAcknowledged,
      playerId,
      cueId,
    };
  }

  acknowledgeResultsFailure(sessionId: string, nowMs = Date.now()): ResultsCommitLifecycle {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "results") {
      throw new Error(`Session ${sessionId} is not in post-match results`);
    }

    const lifecycle = room.flowState.resultsLifecycle;
    if (lifecycle.state !== "RESULTS-FAILED" || !lifecycle.acknowledgementRequired || lifecycle.acknowledged) {
      return structuredClone(lifecycle);
    }

    const updatedLifecycle: ResultsCommitLifecycle = {
      ...lifecycle,
      acknowledged: true,
      rematchEnabled: true,
      syncPendingChip: true,
    };

    const flowState: ResultsFlowState = {
      ...room.flowState,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      resultsLifecycle: updatedLifecycle,
    };
    room.flowState = flowState;

    this.eventSink.emit("session.results.failure_acknowledged", {
      sessionId,
      nowMs,
      state: updatedLifecycle.state,
      copyKey: updatedLifecycle.copyKey,
    });
    this.emitFlowStateUpdated(room, flowState, "results_failure_acknowledged");
    this.persistFlowState(flowState, "results_failure_acknowledged");

    return structuredClone(updatedLifecycle);
  }

  markResultsFailedTerminal(
    sessionId: string,
    options: MarkResultsFailedTerminalOptions = {},
  ): ResultsCommitLifecycle {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "results") {
      throw new Error(`Session ${sessionId} is not in post-match results`);
    }

    const lifecycle = room.flowState.resultsLifecycle;
    if (lifecycle.state === "RESULTS-FAILED") {
      return structuredClone(lifecycle);
    }

    const nowMs = options.nowMs ?? Date.now();
    const elapsedMs = Math.max(0, Math.round(options.elapsedMs ?? lifecycle.elapsedMs));
    const attempt =
      options.retryAttempt && options.retryAttempt > 0
        ? Math.floor(options.retryAttempt)
        : lifecycle.attempt;
    const maxAttempts =
      attempt === null
        ? null
        : Math.max(attempt, Math.floor(options.retryMaxAttempts ?? lifecycle.maxAttempts ?? attempt));
    const acknowledged = Boolean(options.failureAcknowledged);

    const updatedLifecycle: ResultsCommitLifecycle = {
      ...lifecycle,
      state: "RESULTS-FAILED",
      copyKey: "results.failed.terminal",
      elapsedMs,
      attempt,
      maxAttempts,
      delayedVariant: false,
      acknowledgementRequired: true,
      acknowledged,
      rematchEnabled: acknowledged,
      syncPendingChip: acknowledged,
      recoveredTransition: null,
    };

    const flowState: ResultsFlowState = {
      ...room.flowState,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      resultsLifecycle: updatedLifecycle,
    };
    room.flowState = flowState;

    this.eventSink.emit("session.results.failed_terminal", {
      sessionId,
      nowMs,
      previousState: lifecycle.state,
      previousCopyKey: lifecycle.copyKey,
      attempt: updatedLifecycle.attempt,
      maxAttempts: updatedLifecycle.maxAttempts,
    });
    this.emitFlowStateUpdated(room, flowState, "leaderboard_commit_failed_terminal");
    this.persistFlowState(flowState, "leaderboard_commit_failed_terminal");

    return structuredClone(updatedLifecycle);
  }

  markResultsRecovered(sessionId: string, nowMs = Date.now()): ResultsCommitLifecycle {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "results") {
      throw new Error(`Session ${sessionId} is not in post-match results`);
    }

    const lifecycle = room.flowState.resultsLifecycle;
    const recoveryEligible =
      lifecycle.state === "RESULTS-RETRYING" || lifecycle.state === "RESULTS-FAILED" || lifecycle.syncPendingChip;
    if (!recoveryEligible) {
      return structuredClone(lifecycle);
    }

    const updatedLifecycle: ResultsCommitLifecycle = {
      ...lifecycle,
      state: "RESULTS-NORMAL",
      copyKey: "results.normal.final_placement",
      delayedVariant: false,
      acknowledgementRequired: false,
      rematchEnabled: true,
      syncPendingChip: false,
      recoveredTransition: {
        stateId: "TS-SERVICE-RECOVERED",
        reason: "leaderboard_commit_succeeded_after_retry_or_failure",
        copyKey: "results.recovered.toast",
        toastDurationMs: RESULTS_RECOVERY_TOAST_DURATION_MS,
        clearsSyncPendingChip: true,
      },
    };

    const flowState: ResultsFlowState = {
      ...room.flowState,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      resultsLifecycle: updatedLifecycle,
    };
    room.flowState = flowState;

    this.eventSink.emit("session.results.recovered", {
      sessionId,
      nowMs,
      previousState: lifecycle.state,
      previousCopyKey: lifecycle.copyKey,
      toastDurationMs: RESULTS_RECOVERY_TOAST_DURATION_MS,
      clearsSyncPendingChip: true,
    });
    this.emitFlowStateUpdated(room, flowState, "leaderboard_commit_succeeded_after_retry_or_failure");
    this.persistFlowState(flowState, "leaderboard_commit_succeeded_after_retry_or_failure");

    return structuredClone(updatedLifecycle);
  }

  selectEliminationAction(
    sessionId: string,
    actionId: EliminationActionId,
    nowMs = Date.now(),
  ): EliminationSelectedRoute {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "in_round") {
      throw new Error(`Session ${sessionId} is not in elimination transition`);
    }

    const eliminationState = room.eliminationTransitionState;
    if (!eliminationState) {
      throw new Error(`Session ${sessionId} has no active elimination transition`);
    }

    if (eliminationState.selectedRoute) {
      return { ...eliminationState.selectedRoute };
    }

    const currentTransition = this.buildEliminationTransition(eliminationState, nowMs);
    if (currentTransition.state !== "ELIM-ACTIONS") {
      throw new Error(`Session ${sessionId} elimination actions are no longer available`);
    }

    const selectedAction = this.buildEliminationActionCtas(eliminationState.eliminationCause)
      .find((candidate) => candidate.id === actionId);
    if (!selectedAction) {
      throw new Error(`Unknown elimination action ${actionId}`);
    }

    eliminationState.selectedRoute = {
      actionId: selectedAction.id,
      routeTarget: selectedAction.routeTarget,
      reason: "player_selected",
      selectedAtMs: nowMs,
    };

    const session = this.requireLiveSession(room, sessionId);
    const snapshot = session.getSnapshot();
    const inRoundContracts = this.resolveInRoundContracts(room, snapshot, "elimination_route_selected", nowMs);
    const flowState: InRoundFlowState = {
      ...room.flowState,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      world: snapshot.world,
      players: snapshot.players,
      uxState: inRoundContracts.uxState,
      hud: this.buildHudViewModel(snapshot),
      eliminationTransition: inRoundContracts.eliminationTransition,
    };
    room.flowState = flowState;

    this.eventSink.emit("session.elimination.route_selected", {
      sessionId,
      actionId: eliminationState.selectedRoute.actionId,
      routeTarget: eliminationState.selectedRoute.routeTarget,
      reason: eliminationState.selectedRoute.reason,
      selectedAtMs: eliminationState.selectedRoute.selectedAtMs,
    });
    this.emitFlowStateUpdated(room, flowState, "elimination_route_selected");
    this.persistFlowState(flowState, "elimination_route_selected");

    return { ...eliminationState.selectedRoute };
  }

  selectPostMatchAction(
    sessionId: string,
    actionId: PostMatchActionId,
    nowMs = Date.now(),
  ): PostMatchActionAttempt {
    const room = this.requireRoom(sessionId);
    if (room.flowState.phase !== "results") {
      throw new Error(`Session ${sessionId} is not in post-match results`);
    }

    const available = room.flowState.postMatchActions.available;
    if (!room.flowState.resultsLifecycle.rematchEnabled) {
      const blockedAction = available.find((candidate) => candidate.id === actionId);
      if (!blockedAction) {
        throw new Error(`Unknown post-match action ${actionId}`);
      }

      const blockedSelection: PostMatchActionBlockedSelection = {
        actionId: blockedAction.id,
        label: blockedAction.label,
        routeTarget: blockedAction.routeTarget,
        reason: "results_failure_ack_required",
        selectedAtMs: nowMs,
        blocked: true,
        resultsLifecycleState: "RESULTS-FAILED",
        acknowledgementRequired: true,
        acknowledged: false,
        rematchEnabled: false,
        copyKey: "results.failed.terminal",
        guidanceCopy: WIS214_GAME_OVER_COPY.postMatch.blockedGuidance,
      };

      this.eventSink.emit("session.post_match.route_blocked", {
        sessionId,
        actionId: blockedSelection.actionId,
        routeTarget: blockedSelection.routeTarget,
        selectedAtMs: blockedSelection.selectedAtMs,
        reason: blockedSelection.reason,
        resultsLifecycleState: blockedSelection.resultsLifecycleState,
      });

      return blockedSelection;
    }

    if (room.flowState.postMatchActions.routeState === "route_pending" && room.flowState.postMatchActions.selected) {
      return { ...room.flowState.postMatchActions.selected };
    }

    const action = available.find((candidate) => candidate.id === actionId);
    if (!action) {
      throw new Error(`Unknown post-match action ${actionId}`);
    }

    const selected: PostMatchActionSelection = {
      actionId: action.id,
      label: action.label,
      routeTarget: action.routeTarget,
      reason: "player_selected",
      selectedAtMs: nowMs,
      outcomeCopy: action.outcomeCopy,
    };

    const flowState: ResultsFlowState = {
      ...room.flowState,
      revision: room.flowState.revision + 1,
      updatedAt: nowMs,
      postMatchActions: {
        available: available.map((entry) => ({ ...entry })),
        guidanceCopy: room.flowState.postMatchActions.guidanceCopy,
        routeState: "route_pending",
        selected,
      },
    };
    room.flowState = flowState;

    this.eventSink.emit("session.post_match.route_selected", {
      sessionId,
      actionId: selected.actionId,
      routeTarget: selected.routeTarget,
      selectedAtMs: selected.selectedAtMs,
    });
    this.emitFlowStateUpdated(room, flowState, "post_match_route_selected");
    this.persistFlowState(flowState, "post_match_route_selected");

    return selected;
  }

  private emitFlowStateUpdated(room: ManagedRoom, state: RoomFlowState, reason: string): void {
    const realtimeLeaderboard = this.getRealtimeLeaderboardProjection(state);

    this.eventSink.emit("session.leaderboard.updated", {
      sessionId: state.sessionId,
      phase: state.phase,
      revision: state.revision,
      tick: state.world.tick,
      updatedAt: state.updatedAt,
      reason,
      snapshot: realtimeLeaderboard.snapshot,
      updates: realtimeLeaderboard.updates,
    });

    this.eventSink.emit("session.flow_state.updated", {
      sessionId: state.sessionId,
      phase: state.phase,
      uxStateId: state.uxState.id,
      revision: state.revision,
      updatedAt: state.updatedAt,
      reason,
      players: state.players.length,
      tick: state.world.tick,
      resultsLifecycleState: state.phase === "results" ? state.resultsLifecycle.state : null,
    });

    this.emitOnboardingFunnelStartEvents(room, state, reason);
  }

  private getRealtimeLeaderboardProjection(state: RoomFlowState): RealtimeLeaderboardProjection {
    const previous = this.realtimeLeaderboardBySession.get(state.sessionId);
    const room = this.rooms.get(state.sessionId);
    if (room?.integrity.freezeRankings && previous) {
      return previous;
    }
    if (
      previous &&
      previous.revision === state.revision &&
      previous.tick === state.world.tick
    ) {
      return previous;
    }

    const snapshot = this.buildRealtimeLeaderboardSnapshot(state.players);
    const updates = this.buildRealtimeLeaderboardUpdates(previous?.snapshot ?? [], snapshot);
    const projection: RealtimeLeaderboardProjection = {
      revision: state.revision,
      tick: state.world.tick,
      snapshot,
      updates,
    };
    this.realtimeLeaderboardBySession.set(state.sessionId, projection);

    return projection;
  }

  private buildRealtimeLeaderboardSnapshot(players: PlayerSnapshot[]): RealtimeLeaderboardSnapshotEntry[] {
    const sorted = [...players].sort((left, right) => {
      const scoreDelta = computeAuthoritativeScore(right) - computeAuthoritativeScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      if (right.survivalMs !== left.survivalMs) {
        return right.survivalMs - left.survivalMs;
      }

      return left.playerId.localeCompare(right.playerId);
    });

    const tieCounts = new Map<string, number>();
    for (const player of sorted) {
      const key = this.getRealtimeLeaderboardTieKey(player);
      tieCounts.set(key, (tieCounts.get(key) ?? 0) + 1);
    }

    const snapshot: RealtimeLeaderboardSnapshotEntry[] = [];
    let rank = 0;
    let previousScore: number | null = null;
    let previousSurvivalMs: number | null = null;

    for (const [index, player] of sorted.entries()) {
      const score = computeAuthoritativeScore(player);
      if (score !== previousScore || player.survivalMs !== previousSurvivalMs) {
        rank = index + 1;
      }

      const tieKey = this.getRealtimeLeaderboardTieKey(player);
      const isTie = (tieCounts.get(tieKey) ?? 0) > 1;
      snapshot.push({
        playerId: player.playerId,
        rank,
        score,
        survivalMs: player.survivalMs,
        connected: player.connected,
        isEliminated: player.isEliminated,
        eliminationReason: player.eliminationReason,
        isTie,
        placementToken: isTie ? `T-${rank}` : `${rank}`,
      });

      previousScore = score;
      previousSurvivalMs = player.survivalMs;
    }

    return snapshot;
  }

  private buildRealtimeLeaderboardUpdates(
    previous: RealtimeLeaderboardSnapshotEntry[],
    next: RealtimeLeaderboardSnapshotEntry[],
  ): RealtimeLeaderboardIncrementalUpdate[] {
    const previousByPlayer = new Map(previous.map((entry) => [entry.playerId, entry]));
    const nextByPlayer = new Map(next.map((entry) => [entry.playerId, entry]));
    const updates: RealtimeLeaderboardIncrementalUpdate[] = [];

    for (const entry of next) {
      const existing = previousByPlayer.get(entry.playerId);
      if (!existing) {
        updates.push({
          playerId: entry.playerId,
          kind: "joined",
          previousRank: null,
          rank: entry.rank,
          rankDelta: null,
          previousScore: null,
          score: entry.score,
          scoreDelta: null,
          previousSurvivalMs: null,
          survivalMs: entry.survivalMs,
          survivalDeltaMs: null,
          changedFields: [
            "rank",
            "score",
            "survivalMs",
            "connected",
            "isEliminated",
            "eliminationReason",
            "isTie",
            "placementToken",
          ],
        });
        continue;
      }

      const changedFields: RealtimeLeaderboardIncrementalUpdate["changedFields"] = [];
      if (existing.rank !== entry.rank) {
        changedFields.push("rank");
      }
      if (existing.score !== entry.score) {
        changedFields.push("score");
      }
      if (existing.survivalMs !== entry.survivalMs) {
        changedFields.push("survivalMs");
      }
      if (existing.connected !== entry.connected) {
        changedFields.push("connected");
      }
      if (existing.isEliminated !== entry.isEliminated) {
        changedFields.push("isEliminated");
      }
      if (existing.eliminationReason !== entry.eliminationReason) {
        changedFields.push("eliminationReason");
      }
      if (existing.isTie !== entry.isTie) {
        changedFields.push("isTie");
      }
      if (existing.placementToken !== entry.placementToken) {
        changedFields.push("placementToken");
      }

      if (changedFields.length === 0) {
        continue;
      }

      updates.push({
        playerId: entry.playerId,
        kind: "updated",
        previousRank: existing.rank,
        rank: entry.rank,
        rankDelta: existing.rank - entry.rank,
        previousScore: existing.score,
        score: entry.score,
        scoreDelta: entry.score - existing.score,
        previousSurvivalMs: existing.survivalMs,
        survivalMs: entry.survivalMs,
        survivalDeltaMs: entry.survivalMs - existing.survivalMs,
        changedFields,
      });
    }

    for (const entry of previous) {
      if (nextByPlayer.has(entry.playerId)) {
        continue;
      }

      updates.push({
        playerId: entry.playerId,
        kind: "left",
        previousRank: entry.rank,
        rank: null,
        rankDelta: null,
        previousScore: entry.score,
        score: null,
        scoreDelta: null,
        previousSurvivalMs: entry.survivalMs,
        survivalMs: null,
        survivalDeltaMs: null,
        changedFields: ["rank", "score", "survivalMs"],
      });
    }

    return updates;
  }

  private getRealtimeLeaderboardTieKey(player: PlayerSnapshot): string {
    return `${computeAuthoritativeScore(player)}:${player.survivalMs}`;
  }

  private persistFlowState(state: RoomFlowState, reason: string): void {
    if (!this.durableStore) {
      return;
    }

    const persisted: PersistedSessionSnapshot = {
      eventId: `${state.sessionId}:snapshot:${state.revision}`,
      sessionId: state.sessionId,
      revision: state.revision,
      phase: state.phase,
      capturedAt: state.updatedAt,
      world: structuredClone(state.world),
      players: structuredClone(state.players),
      reason,
      completedAt: state.phase === "results" ? state.completedAt : null,
    };

    this.durableStore.appendSessionSnapshot(persisted);
  }

  private createPreMatchState(): ManagedRoom["preMatch"] {
    return {
      minReadyThreshold: PRE_MATCH_MIN_READY_THRESHOLD,
      readyByPlayerId: new Map<string, boolean>(),
      countdown: {
        status: "idle",
        pauseExpiresAtMs: null,
        interruptedByPlayerId: null,
      },
    };
  }

  private syncPreMatchReadiness(preMatch: ManagedRoom["preMatch"], snapshot: SessionSnapshot): void {
    const activePlayerIds = new Set(snapshot.players.map((player) => player.playerId));
    for (const playerId of preMatch.readyByPlayerId.keys()) {
      if (!activePlayerIds.has(playerId)) {
        preMatch.readyByPlayerId.delete(playerId);
      }
    }

    for (const player of snapshot.players) {
      if (!preMatch.readyByPlayerId.has(player.playerId)) {
        preMatch.readyByPlayerId.set(player.playerId, false);
      }
    }
  }

  private syncOnboardingAcknowledgements(room: ManagedRoom, players: PlayerSnapshot[]): void {
    const playerIds = new Set(players.map((player) => player.playerId));
    for (const playerId of room.onboarding.acknowledgedByPlayerId.keys()) {
      if (!playerIds.has(playerId)) {
        room.onboarding.acknowledgedByPlayerId.delete(playerId);
      }
    }
    for (const playerId of room.onboarding.funnelByPlayerId.keys()) {
      if (!playerIds.has(playerId)) {
        room.onboarding.funnelByPlayerId.delete(playerId);
      }
    }

    for (const player of players) {
      if (!room.onboarding.acknowledgedByPlayerId.has(player.playerId)) {
        room.onboarding.acknowledgedByPlayerId.set(player.playerId, new Set());
      }
      if (!room.onboarding.funnelByPlayerId.has(player.playerId)) {
        room.onboarding.funnelByPlayerId.set(player.playerId, this.createOnboardingFunnelTelemetryState());
      }
    }
  }

  private createOnboardingFunnelTelemetryState(): OnboardingFunnelTelemetryState {
    return {
      startedAtMs: null,
      startCueId: null,
      completedAtMs: null,
      quitBeforeFirstFullRoundAtMs: null,
    };
  }

  private getOnboardingFunnelTelemetryState(room: ManagedRoom, playerId: string): OnboardingFunnelTelemetryState {
    let state = room.onboarding.funnelByPlayerId.get(playerId);
    if (!state) {
      state = this.createOnboardingFunnelTelemetryState();
      room.onboarding.funnelByPlayerId.set(playerId, state);
    }
    return state;
  }

  private emitOnboardingFunnelStartEvents(room: ManagedRoom, state: RoomFlowState, reason: string): void {
    this.syncOnboardingAcknowledgements(room, state.players);

    for (const player of state.players) {
      const funnel = this.getOnboardingFunnelTelemetryState(room, player.playerId);
      if (funnel.startedAtMs !== null) {
        continue;
      }

      const acknowledged = room.onboarding.acknowledgedByPlayerId.get(player.playerId) ?? new Set();
      const cue = this.resolveFirstSessionOnboardingCue(state, player, acknowledged);
      if (!cue) {
        continue;
      }

      funnel.startedAtMs = state.updatedAt;
      funnel.startCueId = cue.id;
      this.eventSink.emit("session.onboarding.start", {
        sessionId: state.sessionId,
        playerId: player.playerId,
        cueId: cue.id,
        reason,
        nowMs: state.updatedAt,
      });
    }
  }

  private emitOnboardingQuitBeforeFirstFullRound(
    room: ManagedRoom,
    sessionId: string,
    playerId: string,
    nowMs: number,
    source: "reconnect_expired",
  ): void {
    if (room.onboarding.firstFullRoundCompletedAtMs !== null) {
      return;
    }

    const funnel = this.getOnboardingFunnelTelemetryState(room, playerId);
    if (funnel.quitBeforeFirstFullRoundAtMs !== null) {
      return;
    }
    funnel.quitBeforeFirstFullRoundAtMs = nowMs;

    const acknowledgedSteps = room.onboarding.acknowledgedByPlayerId.get(playerId)?.size ?? 0;
    this.eventSink.emit("session.onboarding.quit_before_first_full_round", {
      sessionId,
      playerId,
      source,
      acknowledgedSteps,
      totalSteps: WIS215_FIRST_SESSION_ONBOARDING_ORDER.length,
      onboardingCompleted: funnel.completedAtMs !== null,
      nowMs,
    });
  }

  private buildFirstSessionOnboardingRuntimeContract(
    room: ManagedRoom,
    state: RoomFlowState,
  ): FirstSessionOnboardingRuntimeContract {
    const byPlayerId = Object.fromEntries(
      state.players.map((player) => {
        const acknowledged = room.onboarding.acknowledgedByPlayerId.get(player.playerId) ?? new Set();
        const cue = this.resolveFirstSessionOnboardingCue(state, player, acknowledged);
        return [player.playerId, cue];
      }),
    ) as Record<string, OnboardingCueRuntimeContract | null>;

    return {
      cueOrder: [...WIS215_FIRST_SESSION_ONBOARDING_ORDER],
      byPlayerId,
    };
  }

  private resolveFirstSessionOnboardingCue(
    state: RoomFlowState,
    player: PlayerSnapshot,
    acknowledged: Set<Wis215FirstSessionOnboardingCueId>,
  ): OnboardingCueRuntimeContract | null {
    if (player.isEliminated || state.uxState.id === "HUD-ELIMINATED") {
      return null;
    }

    for (const cueId of WIS215_FIRST_SESSION_ONBOARDING_ORDER) {
      if (acknowledged.has(cueId)) {
        continue;
      }

      if (cueId === "OB-QUEUE-FALLBACK" && state.uxState.id !== "TS-CONNECT-FAILED") {
        continue;
      }

      if (cueId === "OB-COUNTDOWN-READY" && state.uxState.id !== "PM-COUNTDOWN") {
        continue;
      }

      if (
        cueId === "OB-HAZARD-URGENCY" &&
        !(
          state.uxState.id === "HUD-ACTIVE" &&
          (state.uxState.risingGround?.state === "RG-WARNING" || state.uxState.risingGround?.state === "RG-CRITICAL")
        )
      ) {
        continue;
      }

      const definition = WIS215_FIRST_SESSION_ONBOARDING_CUES[cueId];
      if (definition.suppressedUxStateIds.includes(state.uxState.id)) {
        continue;
      }

      return {
        id: cueId,
        title: definition.title,
        body: definition.body,
        ctaLabel: definition.ctaLabel,
        dismissible: definition.dismissible,
        nonBlocking: definition.nonBlocking,
      };
    }

    return null;
  }

  private buildPreMatchReadiness(
    preMatch: ManagedRoom["preMatch"],
    snapshot: SessionSnapshot,
  ): PreMatchReadinessContract {
    const players = snapshot.players.map((player) => ({
      playerId: player.playerId,
      ready: preMatch.readyByPlayerId.get(player.playerId) ?? false,
      connected: player.connected,
    }));
    const readyCount = players.filter((player) => player.ready && player.connected).length;

    return {
      minReadyThreshold: preMatch.minReadyThreshold,
      readyCount,
      thresholdSatisfied: readyCount >= preMatch.minReadyThreshold,
      players,
    };
  }

  private resolveLobbyUxState(
    room: ManagedRoom,
    snapshot: SessionSnapshot,
    nowMs: number,
    trigger:
      | "created"
      | "player_joined"
      | "player_ready_changed"
      | "player_disconnected"
      | "player_reconnected"
      | "player_reconnect_failed"
      | "transport_connected",
    triggerPlayerId?: string,
  ): UxFlowStateContract {
    this.syncPreMatchReadiness(room.preMatch, snapshot);
    const readiness = this.buildPreMatchReadiness(room.preMatch, snapshot);
    const countdown = room.preMatch.countdown;

    if (
      countdown.status === "paused" &&
      countdown.pauseExpiresAtMs !== null &&
      nowMs >= countdown.pauseExpiresAtMs &&
      !readiness.thresholdSatisfied
    ) {
      countdown.status = "idle";
      countdown.pauseExpiresAtMs = null;
      countdown.interruptedByPlayerId = null;

      return {
        id: "PM-LOBBY-STATUS",
        reason: "cancelled",
        readiness,
        countdownInterruption: {
          state: "cancelled",
          reason: "min_ready_not_met",
          pauseCapMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
        },
      };
    }

    if (countdown.status === "active" && !readiness.thresholdSatisfied) {
      if (trigger === "player_disconnected") {
        countdown.status = "paused";
        countdown.pauseExpiresAtMs = nowMs + PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS;
        countdown.interruptedByPlayerId = triggerPlayerId ?? null;

        return {
          id: "PM-COUNTDOWN",
          reason: "paused",
          countdownSeconds: PRE_MATCH_COUNTDOWN_SECONDS,
          readiness,
          countdownInterruption: {
            state: "paused",
            reason: "player_disconnected",
            pauseCapMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
            pauseRemainingMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
            interruptedByPlayerId: countdown.interruptedByPlayerId ?? undefined,
          },
        };
      }

      countdown.status = "idle";
      countdown.pauseExpiresAtMs = null;
      countdown.interruptedByPlayerId = null;

      return {
        id: "PM-LOBBY-STATUS",
        reason: "cancelled",
        readiness,
        countdownInterruption: {
          state: "cancelled",
          reason: "min_ready_not_met",
          pauseCapMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
        },
      };
    }

    if (countdown.status === "paused") {
      if (readiness.thresholdSatisfied) {
        countdown.status = "active";
        countdown.pauseExpiresAtMs = null;
        countdown.interruptedByPlayerId = null;

        return {
          id: "PM-COUNTDOWN",
          reason: "resumed",
          countdownSeconds: PRE_MATCH_COUNTDOWN_SECONDS,
          readiness,
          countdownInterruption: {
            state: "resumed",
            reason: "player_reconnected",
            pauseCapMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
          },
        };
      }

      const pauseRemainingMs = Math.max(0, (countdown.pauseExpiresAtMs ?? nowMs) - nowMs);
      return {
        id: "PM-COUNTDOWN",
        reason: "paused",
        countdownSeconds: PRE_MATCH_COUNTDOWN_SECONDS,
        readiness,
        countdownInterruption: {
          state: "paused",
          reason: "player_disconnected",
          pauseCapMs: PRE_MATCH_COUNTDOWN_PAUSE_CAP_MS,
          pauseRemainingMs,
          interruptedByPlayerId: countdown.interruptedByPlayerId ?? undefined,
        },
      };
    }

    if (countdown.status === "idle" && readiness.thresholdSatisfied) {
      countdown.status = "active";
      countdown.pauseExpiresAtMs = null;
      countdown.interruptedByPlayerId = null;

      return {
        id: "PM-COUNTDOWN",
        reason: "ready_threshold_met",
        countdownSeconds: PRE_MATCH_COUNTDOWN_SECONDS,
        readiness,
      };
    }

    if (countdown.status === "active") {
      return {
        id: "PM-COUNTDOWN",
        reason: "ready_threshold_met",
        countdownSeconds: PRE_MATCH_COUNTDOWN_SECONDS,
        readiness,
      };
    }

    return {
      id: "PM-LOBBY-STATUS",
      reason: trigger === "created" || trigger === "transport_connected" ? trigger : "waiting_for_ready",
      readiness,
    };
  }

  private resolveInRoundContracts(
    room: ManagedRoom,
    snapshot: SessionSnapshot,
    reason: string,
    nowMs: number,
    reconnectReason?: ReconnectResult["reason"],
  ): {
    uxState: UxFlowStateContract;
    eliminationTransition?: EliminationTransitionContract;
  } {
    const risingGround = this.resolveRisingGroundContract(room, snapshot, nowMs);
    const reconnectTimeout = this.resolveReconnectTimeoutContract(room, snapshot, nowMs, reconnectReason);
    const eliminated = snapshot.players.find((player) => player.isEliminated && player.eliminationReason !== null);
    if (eliminated) {
      if (
        !room.eliminationTransitionState ||
        room.eliminationTransitionState.eliminationCause !== eliminated.eliminationReason
      ) {
        room.eliminationTransitionState = {
          startedAtMs: nowMs,
          eliminationCause: eliminated.eliminationReason,
          selectedRoute: null,
        };
      }

      const eliminationTransition = this.buildEliminationTransition(room.eliminationTransitionState, nowMs);
      this.maybeEmitRisingGroundEliminationFollowupEvents(room, snapshot, eliminationTransition, nowMs);

      return {
        uxState: {
          id: "HUD-ELIMINATED",
          reason,
          eliminationCause: eliminated.eliminationReason,
          reconnectReason,
          reconnectTimeout,
          risingGround,
        },
        eliminationTransition,
      };
    }

    room.eliminationTransitionState = null;

    const reconnecting = snapshot.players.some((player) => !player.connected && !player.isEliminated);
    if (reconnecting || reconnectReason) {
      return {
        uxState: {
          id: "HUD-RECONNECTING",
          reason,
          reconnectReason,
          reconnectTimeout,
          risingGround,
        },
      };
    }

    return {
      uxState: {
        id: "HUD-ACTIVE",
        reason,
        risingGround,
      },
    };
  }

  private resolveRisingGroundContract(
    room: ManagedRoom,
    snapshot: SessionSnapshot,
    nowMs: number,
  ): RisingGroundUxContract | undefined {
    const candidate = this.deriveRisingGroundCandidate(room, snapshot);
    if (!candidate) {
      return undefined;
    }

    const tracker = room.risingGround;
    const previousState = tracker.state;
    const previousDangerTier = tracker.dangerTier;
    const previousSeverity = this.getRisingGroundStateSeverity(previousState);
    const candidateSeverity = this.getRisingGroundStateSeverity(candidate.state);

    let shouldTransition = false;

    if (!previousState) {
      shouldTransition = true;
    } else if (candidate.state !== previousState) {
      if (
        nowMs - tracker.enteredAtMs < WIS135_RISING_GROUND_TIMING_MS.sameTierDebounce &&
        candidateSeverity <= previousSeverity
      ) {
        shouldTransition = false;
      } else if (candidateSeverity > previousSeverity) {
        shouldTransition = true;
      } else {
        const minDwellMs = this.getRisingGroundMinDwellMs(previousState);
        shouldTransition = nowMs - tracker.enteredAtMs >= minDwellMs;
      }
    } else {
      tracker.playerId = candidate.playerId;
      tracker.groundSpeedMultiplier = candidate.groundSpeedMultiplier;
      tracker.clearancePct = candidate.clearancePct;
      tracker.dangerTier = candidate.dangerTier;
      return this.buildRisingGroundUxContract(tracker);
    }

    if (!shouldTransition) {
      return this.buildRisingGroundUxContract(tracker);
    }

    tracker.state = candidate.state;
    tracker.enteredAtMs = nowMs;
    tracker.playerId = candidate.playerId;
    tracker.dangerTier = candidate.dangerTier;
    tracker.clearancePct = candidate.clearancePct;
    tracker.groundSpeedMultiplier = candidate.groundSpeedMultiplier;

    if (candidate.state === "RG-ELIMINATED") {
      tracker.eliminationTriggeredAtMs = nowMs;
      tracker.actionsShownAtMs = null;
      tracker.autoRouteEmitted = false;
      this.emitRisingGroundEliminationTriggered(snapshot, candidate, nowMs);
      return this.buildRisingGroundUxContract(tracker);
    }

    tracker.eliminationTriggeredAtMs = null;
    tracker.actionsShownAtMs = null;
    tracker.autoRouteEmitted = false;

    if (previousState && previousState !== candidate.state && previousSeverity > candidateSeverity) {
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.deescalate, {
        matchId: snapshot.sessionId,
        playerId: candidate.playerId,
        fromTier: this.toDangerTierLabel(previousState, previousDangerTier),
        toTier: candidate.dangerTier,
        groundSpeedMultiplier: candidate.groundSpeedMultiplier,
        serverTs: nowMs,
      });
      return this.buildRisingGroundUxContract(tracker);
    }

    if (candidate.state === "RG-NORMAL") {
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.normalEnter, {
        matchId: snapshot.sessionId,
        playerId: candidate.playerId,
        dangerTier: candidate.dangerTier,
        groundSpeedMultiplier: candidate.groundSpeedMultiplier,
        serverTs: nowMs,
      });
    } else if (candidate.state === "RG-WARNING") {
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.warningEnter, {
        matchId: snapshot.sessionId,
        playerId: candidate.playerId,
        dangerTier: "WARNING",
        groundSpeedMultiplier: candidate.groundSpeedMultiplier,
        clearancePct: candidate.clearancePct ?? 0,
        serverTs: nowMs,
      });
    } else if (candidate.state === "RG-CRITICAL") {
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.criticalEnter, {
        matchId: snapshot.sessionId,
        playerId: candidate.playerId,
        dangerTier: "CRITICAL",
        groundSpeedMultiplier: candidate.groundSpeedMultiplier,
        clearancePct: candidate.clearancePct ?? 0,
        serverTs: nowMs,
      });
    }

    return this.buildRisingGroundUxContract(tracker);
  }

  private resolveReconnectTimeoutContract(
    room: ManagedRoom,
    snapshot: SessionSnapshot,
    nowMs: number,
    reconnectReason?: ReconnectResult["reason"],
  ): ReconnectTimeoutContract | undefined {
    const reconnectingExpiries = snapshot.players
      .filter((player) => !player.connected && !player.isEliminated && player.reconnectExpiresAtMs !== null)
      .map((player) => player.reconnectExpiresAtMs as number);

    if (reconnectingExpiries.length > 0) {
      const expiresAtMs = Math.min(...reconnectingExpiries);
      return {
        budgetMs: room.reconnectWindowMs,
        remainingMs: Math.max(0, expiresAtMs - nowMs),
        expiresAtMs,
      };
    }

    const timeoutExpiries = snapshot.players
      .filter(
        (player) =>
          player.isEliminated &&
          player.eliminationReason === "disconnected" &&
          player.reconnectExpiresAtMs !== null,
      )
      .map((player) => player.reconnectExpiresAtMs as number);

    if (timeoutExpiries.length > 0 || reconnectReason === "token_expired") {
      const expiresAtMs = timeoutExpiries.length > 0 ? Math.max(...timeoutExpiries) : nowMs;
      return {
        budgetMs: room.reconnectWindowMs,
        remainingMs: 0,
        expiresAtMs,
        terminalReason: "token_expired",
      };
    }

    return undefined;
  }

  private buildEliminationTransition(
    eliminationState: NonNullable<ManagedRoom["eliminationTransitionState"]>,
    nowMs: number,
  ): EliminationTransitionContract {
    const enteredAtMs = eliminationState.startedAtMs;
    const elapsedMs = Math.max(0, nowMs - enteredAtMs);
    const autoRouteAtMs = enteredAtMs + ELIM_IMPACT_DURATION_MS + ELIM_ACTIONS_TIMEOUT_MS;
    const actionCtas = this.buildEliminationActionCtas(eliminationState.eliminationCause);
    const selectedRoute = eliminationState.selectedRoute;
    const headlineCopy = WIS214_GAME_OVER_COPY.elimination.headline;
    const helperCopy = WIS214_GAME_OVER_COPY.elimination.helper;
    const autoRouteCopy = WIS214_GAME_OVER_COPY.elimination.autoRouteCta;

    if (selectedRoute) {
      return {
        state:
          selectedRoute.routeTarget === "spectator_mode"
            ? "ELIM-SPECTATOR"
            : selectedRoute.reason === "player_selected"
              ? "ELIM-MANUAL-RESULTS"
              : "ELIM-AUTO-RESULTS",
        eliminationCause: eliminationState.eliminationCause,
        enteredAtMs,
        elapsedMs,
        impactDurationMs: ELIM_IMPACT_DURATION_MS,
        actionsTimeoutMs: ELIM_ACTIONS_TIMEOUT_MS,
        autoRouteAtMs,
        autoRouteTarget: "results_screen",
        headlineCopy,
        helperCopy,
        autoRouteCopy,
        actionCtas,
        route: { ...selectedRoute },
      };
    }

    if (elapsedMs < ELIM_IMPACT_DURATION_MS) {
      return {
        state: "ELIM-IMPACT",
        eliminationCause: eliminationState.eliminationCause,
        enteredAtMs,
        elapsedMs,
        impactDurationMs: ELIM_IMPACT_DURATION_MS,
        actionsTimeoutMs: ELIM_ACTIONS_TIMEOUT_MS,
        autoRouteAtMs,
        autoRouteTarget: "results_screen",
        headlineCopy,
        helperCopy,
        autoRouteCopy,
        actionCtas,
        route: null,
      };
    }

    if (nowMs < autoRouteAtMs) {
      return {
        state: "ELIM-ACTIONS",
        eliminationCause: eliminationState.eliminationCause,
        enteredAtMs,
        elapsedMs,
        impactDurationMs: ELIM_IMPACT_DURATION_MS,
        actionsTimeoutMs: ELIM_ACTIONS_TIMEOUT_MS,
        autoRouteAtMs,
        autoRouteTarget: "results_screen",
        headlineCopy,
        helperCopy,
        autoRouteCopy,
        actionCtas,
        route: null,
      };
    }

    const autoRouteActionId: EliminationAutoRoute["actionId"] = eliminationState.eliminationCause === "ground"
      ? "VIEW_LEADERBOARD"
      : "VIEW_RESULTS";
    eliminationState.selectedRoute = {
      actionId: autoRouteActionId,
      routeTarget: "results_screen",
      reason: "inactivity_timeout",
      selectedAtMs: nowMs,
    };

    return {
      state: "ELIM-AUTO-RESULTS",
      eliminationCause: eliminationState.eliminationCause,
      enteredAtMs,
      elapsedMs,
      impactDurationMs: ELIM_IMPACT_DURATION_MS,
      actionsTimeoutMs: ELIM_ACTIONS_TIMEOUT_MS,
      autoRouteAtMs,
      autoRouteTarget: "results_screen",
      headlineCopy,
      helperCopy,
      autoRouteCopy,
      actionCtas,
      route: { ...eliminationState.selectedRoute },
    };
  }

  private buildEliminationActionCtas(eliminationCause: PlayerSnapshot["eliminationReason"]): EliminationActionCta[] {
    const copy = WIS214_GAME_OVER_COPY.elimination.actionOutcome;
    if (eliminationCause === "ground") {
      return [
        {
          id: "SPECTATE",
          label: "Spectate",
          routeTarget: "spectator_mode",
          style: "primary",
          outcomeCopy: copy.SPECTATE,
        },
        {
          id: "VIEW_LEADERBOARD",
          label: "View Leaderboard",
          routeTarget: "results_screen",
          style: "secondary",
          outcomeCopy: copy.VIEW_LEADERBOARD,
        },
      ];
    }

    return [
      {
        id: "VIEW_RESULTS",
        label: "View Results",
        routeTarget: "results_screen",
        style: "primary",
        outcomeCopy: copy.VIEW_RESULTS,
      },
      {
        id: "SPECTATE",
        label: "Spectate",
        routeTarget: "spectator_mode",
        style: "secondary",
        outcomeCopy: copy.SPECTATE,
      },
    ];
  }

  private deriveRisingGroundCandidate(room: ManagedRoom, snapshot: SessionSnapshot): RisingGroundCandidate | null {
    if (snapshot.players.length === 0) {
      return null;
    }

    const groundSpeedMultiplier = roundMetric(snapshot.world.groundRiseSpeed / room.risingGround.baselineGroundSpeed);
    const risingGroundEliminated = snapshot.players
      .filter((player) => player.isEliminated && player.eliminationReason === "ground")
      .sort((left, right) => left.playerId.localeCompare(right.playerId))[0];
    if (risingGroundEliminated) {
      return {
        state: "RG-ELIMINATED",
        playerId: risingGroundEliminated.playerId,
        dangerTier: "CRITICAL",
        groundSpeedMultiplier,
        clearancePct: 0,
      };
    }

    const activePlayers = snapshot.players
      .filter((player) => !player.isEliminated)
      .sort((left, right) => {
        const leftClearance = left.height - snapshot.world.groundHeight;
        const rightClearance = right.height - snapshot.world.groundHeight;
        if (leftClearance !== rightClearance) {
          return leftClearance - rightClearance;
        }

        return left.playerId.localeCompare(right.playerId);
      });
    const target = activePlayers[0];
    if (!target) {
      return null;
    }

    const clearance = target.height - snapshot.world.groundHeight;
    const clearancePct = roundMetric(clampMetric((clearance / 4) * 100, 0, 100));
    const dangerTier = this.resolveRisingGroundDangerTier(groundSpeedMultiplier, clearancePct);

    return {
      state: dangerTier === "CRITICAL"
        ? "RG-CRITICAL"
        : dangerTier === "WARNING"
          ? "RG-WARNING"
          : "RG-NORMAL",
      playerId: target.playerId,
      dangerTier,
      groundSpeedMultiplier,
      clearancePct,
    };
  }

  private resolveRisingGroundDangerTier(
    groundSpeedMultiplier: number,
    clearancePct: number,
  ): Wis135RisingGroundDangerTier {
    if (clearancePct <= 20 || groundSpeedMultiplier >= 1.8) {
      return "CRITICAL";
    }
    if (clearancePct <= 45 || groundSpeedMultiplier >= 1.4) {
      return "WARNING";
    }
    if (clearancePct <= 70 || groundSpeedMultiplier >= 1.15) {
      return "MED";
    }
    return "LOW";
  }

  private getRisingGroundMinDwellMs(state: Wis135RisingGroundRuntimeState): number {
    if (state === "RG-WARNING") {
      return WIS135_RISING_GROUND_TIMING_MS.warningMinDwell;
    }
    if (state === "RG-CRITICAL") {
      return WIS135_RISING_GROUND_TIMING_MS.criticalMinDwell;
    }
    return 0;
  }

  private getRisingGroundStateSeverity(state: Wis135RisingGroundRuntimeState | null): number {
    if (state === "RG-NORMAL") {
      return 1;
    }
    if (state === "RG-WARNING") {
      return 2;
    }
    if (state === "RG-CRITICAL") {
      return 3;
    }
    if (state === "RG-ELIMINATED") {
      return 4;
    }
    return 0;
  }

  private toDangerTierLabel(
    state: Wis135RisingGroundRuntimeState,
    normalTier: Wis135RisingGroundDangerTier | null,
  ): Wis135RisingGroundDangerTier {
    if (state === "RG-WARNING") {
      return "WARNING";
    }
    if (state === "RG-CRITICAL" || state === "RG-ELIMINATED") {
      return "CRITICAL";
    }
    return normalTier === "MED" ? "MED" : "LOW";
  }

  private emitRisingGroundEliminationTriggered(
    snapshot: SessionSnapshot,
    candidate: RisingGroundCandidate,
    nowMs: number,
  ): void {
    const eliminatedPlayer = snapshot.players.find((player) => player.playerId === candidate.playerId);
    if (!eliminatedPlayer) {
      return;
    }

    const rankAtElim = this.buildRankIndex(snapshot.players).get(candidate.playerId) ?? snapshot.players.length;
    const aliveAtElim = snapshot.players.filter((player) => !player.isEliminated).length;
    this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.eliminationTriggered, {
      matchId: snapshot.sessionId,
      playerId: candidate.playerId,
      cause: "rising_ground",
      survivalMs: eliminatedPlayer.survivalMs,
      rankAtElim,
      aliveAtElim,
      serverTs: nowMs,
    });
  }

  private maybeEmitRisingGroundEliminationFollowupEvents(
    room: ManagedRoom,
    snapshot: SessionSnapshot,
    eliminationTransition: EliminationTransitionContract,
    nowMs: number,
  ): void {
    if (room.risingGround.state !== "RG-ELIMINATED" || !room.risingGround.playerId) {
      return;
    }
    if (eliminationTransition.eliminationCause !== "ground") {
      return;
    }

    const playerId = room.risingGround.playerId;
    const shownAtMsFallback =
      (room.risingGround.eliminationTriggeredAtMs ?? nowMs) + WIS135_RISING_GROUND_TIMING_MS.eliminationImpact;

    if (
      (eliminationTransition.state === "ELIM-ACTIONS" || eliminationTransition.state === "ELIM-AUTO-RESULTS") &&
      room.risingGround.actionsShownAtMs === null
    ) {
      const shownAtMs = eliminationTransition.state === "ELIM-ACTIONS" ? nowMs : shownAtMsFallback;
      room.risingGround.actionsShownAtMs = shownAtMs;
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.eliminationActionsShown, {
        matchId: snapshot.sessionId,
        playerId,
        actions: ["spectate", "view_leaderboard"],
        shownAtMs,
      });
    }

    if (eliminationTransition.state === "ELIM-AUTO-RESULTS" && !room.risingGround.autoRouteEmitted) {
      const shownAtMs = room.risingGround.actionsShownAtMs ?? shownAtMsFallback;
      room.risingGround.autoRouteEmitted = true;
      this.eventSink.emit(WIS135_RISING_GROUND_EVENT_NAMES.eliminationAutoRoute, {
        matchId: snapshot.sessionId,
        playerId,
        route: "view_leaderboard",
        trigger: "timeout",
        elapsedMs: Math.max(0, nowMs - shownAtMs),
      });
    }
  }

  private buildRisingGroundUxContract(tracker: ManagedRoom["risingGround"]): RisingGroundUxContract | undefined {
    if (!tracker.state || !tracker.playerId || !tracker.dangerTier) {
      return undefined;
    }

    if (tracker.state === "RG-NORMAL") {
      return {
        state: tracker.state,
        copy: WIS135_RISING_GROUND_COPY.normal,
        dangerTier: tracker.dangerTier === "MED" ? "MED" : "LOW",
        groundSpeedMultiplier: tracker.groundSpeedMultiplier,
        clearancePct: tracker.clearancePct,
        enteredAtMs: tracker.enteredAtMs,
        timingMs: { ...WIS135_RISING_GROUND_TIMING_MS },
        visibility: {
          desktop: WIS135_RISING_GROUND_VISIBILITY.normal.desktop,
          mobile: WIS135_RISING_GROUND_VISIBILITY.normal.mobile,
        },
        rankToastSuppressed: false,
        gameplayInputLocked: false,
      };
    }

    if (tracker.state === "RG-WARNING") {
      return {
        state: tracker.state,
        copy: WIS135_RISING_GROUND_COPY.warning,
        dangerTier: "WARNING",
        groundSpeedMultiplier: tracker.groundSpeedMultiplier,
        clearancePct: tracker.clearancePct,
        enteredAtMs: tracker.enteredAtMs,
        timingMs: { ...WIS135_RISING_GROUND_TIMING_MS },
        visibility: {
          desktop: WIS135_RISING_GROUND_VISIBILITY.warning.desktop,
          mobile: WIS135_RISING_GROUND_VISIBILITY.warning.mobile,
        },
        rankToastSuppressed: false,
        gameplayInputLocked: false,
      };
    }

    if (tracker.state === "RG-CRITICAL") {
      return {
        state: tracker.state,
        copy: WIS135_RISING_GROUND_COPY.critical,
        dangerTier: "CRITICAL",
        groundSpeedMultiplier: tracker.groundSpeedMultiplier,
        clearancePct: tracker.clearancePct,
        enteredAtMs: tracker.enteredAtMs,
        timingMs: { ...WIS135_RISING_GROUND_TIMING_MS },
        visibility: {
          desktop: WIS135_RISING_GROUND_VISIBILITY.critical.desktop,
          mobile: WIS135_RISING_GROUND_VISIBILITY.critical.mobile,
        },
        rankToastSuppressed: true,
        gameplayInputLocked: false,
      };
    }

    return {
      state: tracker.state,
      copy: WIS135_RISING_GROUND_COPY.eliminated.status,
      causeCopy: WIS135_RISING_GROUND_COPY.eliminated.cause,
      helperCopy: WIS135_RISING_GROUND_COPY.eliminated.helper,
      actions: [...WIS135_RISING_GROUND_COPY.eliminated.actions],
      dangerTier: "CRITICAL",
      groundSpeedMultiplier: tracker.groundSpeedMultiplier,
      clearancePct: tracker.clearancePct,
      enteredAtMs: tracker.enteredAtMs,
      timingMs: { ...WIS135_RISING_GROUND_TIMING_MS },
      visibility: {
        desktop: WIS135_RISING_GROUND_VISIBILITY.eliminated.desktop,
        mobile: WIS135_RISING_GROUND_VISIBILITY.eliminated.mobile,
      },
      rankToastSuppressed: true,
      gameplayInputLocked: true,
    };
  }

  private buildHudViewModel(snapshot: SessionSnapshot): HudViewModel {
    const totalPlayers = snapshot.players.length;
    const alivePlayers = snapshot.players.filter((player) => !player.isEliminated).length;
    const rankByPlayer = this.buildRankIndex(snapshot.players);
    const groundSpeed = formatGroundSpeed(snapshot.world.groundRiseSpeed);

    const byPlayerId = Object.fromEntries(
      snapshot.players.map((player) => {
        const rank = rankByPlayer.get(player.playerId) ?? totalPlayers;
        const hud: HudPlayerViewModel = {
          rank: {
            label: "Rank",
            value: `#${rank}/${totalPlayers}`,
          },
          score: {
            label: "Score",
            value: computeAuthoritativeScore(player),
          },
          survivalTime: {
            label: "Survival Time",
            value: formatSurvivalTime(player.survivalMs),
          },
          groundSpeed: {
            label: "Ground Speed",
            value: groundSpeed,
          },
          playersLeft: {
            label: "Players Left",
            value: `${alivePlayers}/${totalPlayers}`,
          },
        };

        return [player.playerId, hud];
      }),
    ) as Record<string, HudPlayerViewModel>;

    return {
      cadence: {
        rank: "4Hz",
        score: "4Hz",
        survivalTime: "1Hz",
        groundSpeed: "event",
        playersLeft: "4Hz",
      },
      byPlayerId,
    };
  }

  private buildRankIndex(players: PlayerSnapshot[]): Map<string, number> {
    const sorted = [...players].sort((left, right) => {
      const scoreDelta = computeAuthoritativeScore(right) - computeAuthoritativeScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      if (right.survivalMs !== left.survivalMs) {
        return right.survivalMs - left.survivalMs;
      }

      return left.playerId.localeCompare(right.playerId);
    });

    const rankByPlayer = new Map<string, number>();
    let rank = 0;
    let previousScore: number | null = null;
    let previousSurvival: number | null = null;

    for (const [index, player] of sorted.entries()) {
      const score = computeAuthoritativeScore(player);
      if (score !== previousScore || player.survivalMs !== previousSurvival) {
        rank = index + 1;
      }

      rankByPlayer.set(player.playerId, rank);
      previousScore = score;
      previousSurvival = player.survivalMs;
    }

    return rankByPlayer;
  }

  private buildResultsLifecycle(options: CompleteRoomOptions): ResultsCommitLifecycle {
    const elapsedMs = Math.max(0, Math.round(options.commitLatencyMs ?? 0));
    const attempt = options.retryAttempt && options.retryAttempt > 0 ? Math.floor(options.retryAttempt) : null;
    const maxAttempts =
      attempt === null ? null : Math.max(attempt, Math.floor(options.retryMaxAttempts ?? options.retryAttempt ?? 1));

    if (options.commitFailedTerminal) {
      const acknowledged = Boolean(options.failureAcknowledged);
      return {
        state: "RESULTS-FAILED",
        copyKey: "results.failed.terminal",
        elapsedMs,
        attempt,
        maxAttempts,
        delayedVariant: false,
        acknowledgementRequired: true,
        acknowledged,
        rematchEnabled: acknowledged,
        syncPendingChip: acknowledged,
        recoveredTransition: null,
      };
    }

    if (attempt !== null) {
      const delayedVariant = elapsedMs > 5_000;
      return {
        state: "RESULTS-RETRYING",
        copyKey: delayedVariant ? "results.retrying.delayed" : "results.retrying.active",
        elapsedMs,
        attempt,
        maxAttempts,
        delayedVariant,
        acknowledgementRequired: false,
        acknowledged: false,
        rematchEnabled: true,
        syncPendingChip: true,
        recoveredTransition: null,
      };
    }

    if (elapsedMs > 400) {
      return {
        state: "RESULTS-PENDING",
        copyKey: "results.pending.saving",
        elapsedMs,
        attempt: null,
        maxAttempts: null,
        delayedVariant: false,
        acknowledgementRequired: false,
        acknowledged: false,
        rematchEnabled: true,
        syncPendingChip: true,
        recoveredTransition: null,
      };
    }

    return {
      state: "RESULTS-NORMAL",
      copyKey: "results.normal.final_placement",
      elapsedMs,
      attempt: null,
      maxAttempts: null,
      delayedVariant: false,
      acknowledgementRequired: false,
      acknowledged: false,
      rematchEnabled: true,
      syncPendingChip: false,
      recoveredTransition: null,
    };
  }

  private buildPostMatchActions(): PostMatchActionsContract {
    return {
      available: [
        {
          id: "REPLAY_MATCH",
          label: "Replay Match",
          routeTarget: "pre_match.ready_check",
          style: "primary",
          outcomeCopy: WIS214_GAME_OVER_COPY.postMatch.actionOutcome.REPLAY_MATCH,
        },
        {
          id: "BACK_TO_LOBBY",
          label: "Back to Lobby",
          routeTarget: "pre_match.lobby_ready",
          style: "secondary",
          outcomeCopy: WIS214_GAME_OVER_COPY.postMatch.actionOutcome.BACK_TO_LOBBY,
        },
        {
          id: "EXIT_TO_MENU",
          label: "Exit to Menu",
          routeTarget: "shell.main_menu",
          style: "secondary",
          outcomeCopy: WIS214_GAME_OVER_COPY.postMatch.actionOutcome.EXIT_TO_MENU,
        },
      ],
      guidanceCopy: WIS214_GAME_OVER_COPY.postMatch.guidance,
      routeState: "idle",
      selected: null,
    };
  }

  private getMatchFinalEventId(sessionId: string): string {
    return `match-final:${sessionId}`;
  }

  private computeTickLagMs(room: ManagedRoom, deltaMs: number, nowMs: number): number {
    if (deltaMs <= 0) {
      return 0;
    }

    const expectedAdvanceAtMs = room.lastAdvanceAtMs + deltaMs;
    return Math.max(0, nowMs - expectedAdvanceAtMs);
  }

  private emitReconnectSlo(
    room: ManagedRoom,
    sessionId: string,
    reconnect: ReconnectResult,
    nowMs: number,
  ): void {
    const reason: keyof ManagedRoom["reconnectSlo"]["reasonBreakdown"] = reconnect.connected
      ? "connected"
      : reconnect.reason ?? "unknown_token";

    room.reconnectSlo.attempts += 1;
    if (reconnect.connected) {
      room.reconnectSlo.successes += 1;
    }
    room.reconnectSlo.reasonBreakdown[reason] += 1;

    const attempts = room.reconnectSlo.attempts;
    const successes = room.reconnectSlo.successes;
    const failures = attempts - successes;

    this.eventSink.emit("session.slo.reconnect_success_rate", {
      sessionId,
      reconnectWindowMs: room.reconnectWindowMs,
      attempts,
      successes,
      failures,
      successRate: roundMetric(successes / attempts),
      reasonBreakdown: {
        ...room.reconnectSlo.reasonBreakdown,
      },
      lastReason: reason,
      measuredAt: nowMs,
    });
  }

  private recordIntegrityViolationWithRoom(
    room: ManagedRoom,
    input: RecordIntegrityViolationInput,
    context: {
      tick: number;
      revision: number;
    },
  ): IntegrityViolationTelemetry | null {
    if (!this.integrityConfig.enabled) {
      return null;
    }

    const sessionId = room.flowState.sessionId;
    const windowScope =
      input.category === "input" && this.integrityConfig.enableRejectEscalation ? "input_rejects" : input.ruleId;
    const windowKey = `${sessionId}:${input.playerId ?? "session"}:${windowScope}`;
    const window = this.bumpIntegrityWindow(windowKey, input.detectedAt, this.windowMsForRule(input.ruleId));
    const severity = this.resolveIntegritySeverity(input, window.count);
    const payload: IntegrityViolationTelemetry = {
      sessionId,
      playerId: input.playerId,
      ruleId: input.ruleId,
      category: input.category,
      severity,
      action: input.action,
      tick: context.tick,
      revision: context.revision,
      detectedAt: input.detectedAt,
      threshold: input.threshold,
      windowCount: window.count,
      evidence: input.evidence,
    };

    this.eventSink.emit("session.integrity.violation", payload);
    this.maybeEmitIntegrityEscalation(payload, window.windowStartMs, input.detectedAt);
    return payload;
  }

  private bumpIntegrityWindow(
    key: string,
    nowMs: number,
    windowMs: number,
  ): { count: number; windowStartMs: number } {
    const current = this.integrityWindowsByKey.get(key) ?? [];
    const boundary = nowMs - Math.max(0, windowMs);
    const retained = current.filter((timestamp) => timestamp >= boundary);
    retained.push(nowMs);
    this.integrityWindowsByKey.set(key, retained);
    return {
      count: retained.length,
      windowStartMs: retained[0] ?? nowMs,
    };
  }

  private resolveIntegritySeverity(input: RecordIntegrityViolationInput, windowCount: number): IntegritySeverity {
    let severity = input.severity;

    if (input.category === "input" && this.integrityConfig.enableRejectEscalation) {
      if (windowCount >= this.integrityConfig.rejectEscalationCriticalCount) {
        severity = "critical";
      } else if (windowCount >= this.integrityConfig.rejectEscalationThrottleCount) {
        severity = "elevated";
      }
    }

    if (
      input.ruleId === INTEGRITY_RULE_IDS.timeDriftDesyncBurst &&
      this.integrityConfig.enableDesyncEscalation &&
      windowCount >= this.integrityConfig.desyncEscalationCount &&
      severity === "warn"
    ) {
      severity = "elevated";
    }

    return severity;
  }

  private maybeEmitIntegrityEscalation(
    payload: IntegrityViolationTelemetry,
    windowStartMs: number,
    windowEndMs: number,
  ): void {
    if (payload.severity === "warn") {
      return;
    }

    const key = `${payload.sessionId}:${payload.playerId ?? "session"}:${payload.ruleId}`;
    const previous = this.integrityEscalationByKey.get(key) ?? "warn";
    if (severityRank(payload.severity) <= severityRank(previous)) {
      return;
    }

    this.integrityEscalationByKey.set(key, payload.severity);
    const escalationPayload: IntegrityEscalationTelemetry = {
      sessionId: payload.sessionId,
      playerId: payload.playerId,
      fromSeverity: previous,
      toSeverity: payload.severity,
      triggerRuleId: payload.ruleId,
      windowStartMs,
      windowEndMs,
      violationCount: payload.windowCount,
      escalatedAt: payload.detectedAt,
    };
    this.eventSink.emit("session.integrity.escalated", escalationPayload);
  }

  private windowMsForRule(ruleId: string): number {
    if (ruleId === INTEGRITY_RULE_IDS.timeDriftDesyncBurst) {
      return this.integrityConfig.desyncEscalationWindowMs;
    }
    if (ruleId === INTEGRITY_RULE_IDS.timeDriftTickLag) {
      return this.integrityConfig.tickLagWarnWindowMs;
    }
    return this.integrityConfig.rejectEscalationWindowMs;
  }

  private thresholdForRule(ruleId: string): number | null {
    if (
      ruleId === INTEGRITY_RULE_IDS.impossibleInputEnvelope ||
      ruleId === INTEGRITY_RULE_IDS.impossibleInputOutOfOrder ||
      ruleId === INTEGRITY_RULE_IDS.impossibleInputStale
    ) {
      return 1;
    }
    if (ruleId === INTEGRITY_RULE_IDS.impossibleInputBurst) {
      return this.integrityConfig.rejectEscalationElevatedCount;
    }
    if (ruleId === INTEGRITY_RULE_IDS.timeDriftDesyncBurst) {
      return this.integrityConfig.desyncEscalationCount;
    }
    if (ruleId === INTEGRITY_RULE_IDS.timeDriftTickLag) {
      return this.integrityConfig.tickLagWarnP95Ticks;
    }
    return null;
  }

  private getOrCreateInputControl(
    room: ManagedRoom,
    playerId: string,
  ): { throttleUntilMs: number; quarantined: boolean } {
    const existing = room.integrity.inputControlByPlayerId.get(playerId);
    if (existing) {
      return existing;
    }

    const created = {
      throttleUntilMs: 0,
      quarantined: false,
    };
    room.integrity.inputControlByPlayerId.set(playerId, created);
    return created;
  }

  private applyInputEscalationPolicy(
    room: ManagedRoom,
    playerId: string,
    nowMs: number,
    violation: IntegrityViolationTelemetry | null,
  ): void {
    if (!violation || violation.category !== "input" || !this.integrityConfig.enableRejectEscalation) {
      return;
    }

    const inputControl = this.getOrCreateInputControl(room, playerId);
    if (violation.windowCount >= this.integrityConfig.rejectEscalationCriticalCount) {
      inputControl.quarantined = true;
      return;
    }
    if (violation.windowCount >= this.integrityConfig.rejectEscalationThrottleCount) {
      inputControl.throttleUntilMs = Math.max(
        inputControl.throttleUntilMs,
        nowMs + this.integrityConfig.rejectEscalationThrottleMs,
      );
    }
  }

  private applyDesyncBurstPolicy(
    room: ManagedRoom,
    playerId: string,
    nowMs: number,
    violation: IntegrityViolationTelemetry | null,
  ): void {
    if (
      !violation ||
      violation.ruleId !== INTEGRITY_RULE_IDS.timeDriftDesyncBurst ||
      violation.windowCount < this.integrityConfig.desyncEscalationCount
    ) {
      return;
    }

    const inputControl = this.getOrCreateInputControl(room, playerId);
    inputControl.quarantined = true;
    room.integrity.pendingResyncByPlayerId.add(playerId);
    room.integrity.freezeRankings = true;
    this.eventSink.emit("session.integrity.desync_burst", {
      sessionId: room.flowState.sessionId,
      playerId,
      detectedAt: nowMs,
      windowCount: violation.windowCount,
      windowMs: this.integrityConfig.desyncEscalationWindowMs,
      freezeRankings: room.integrity.freezeRankings,
      resyncCheckpointRequired: true,
    });
  }

  private requireRoom(sessionId: string): ManagedRoom {
    const room = this.rooms.get(sessionId);

    if (!room) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return room;
  }

  private requireLiveSession(room: ManagedRoom, sessionId: string): MultiplayerSession {
    const session = room.session;

    if (!session) {
      throw new Error(`Session ${sessionId} already completed`);
    }

    return session;
  }
}

function computeAuthoritativeScore(player: PlayerSnapshot): number {
  return Math.max(0, Math.round(player.survivalMs / 100 + player.height * 10 - (player.isEliminated ? 40 : 0)));
}

function severityRank(severity: IntegritySeverity): number {
  switch (severity) {
    case "warn":
      return 1;
    case "elevated":
      return 2;
    case "critical":
      return 3;
  }
}

function formatSurvivalTime(survivalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(survivalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatGroundSpeed(groundRiseSpeed: number): string {
  const baseline = 0.5;
  const multiplier = Math.max(0, groundRiseSpeed / baseline);
  const rounded = Math.round(multiplier * 100) / 100;
  const normalized = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  return `x${normalized}`;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clampMetric(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
