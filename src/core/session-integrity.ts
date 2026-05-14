export type IntegrityCategory = "input" | "movement" | "time_drift";

export type IntegritySeverity = "warn" | "elevated" | "critical";

export type IntegrityAction =
  | "reject_input"
  | "sanitize_state"
  | "quarantine_player"
  | "quarantine_session"
  | "observe_only";

export interface SessionIntegrityConfig {
  enabled: boolean;
  enforceInputEnvelope: boolean;
  enforceMovementInvariants: boolean;
  enforceIntentAge: boolean;
  enableRejectEscalation: boolean;
  enableDesyncEscalation: boolean;
  enableTickLagEscalation: boolean;
  maxIntentAgeMs: number;
  rejectEscalationWindowMs: number;
  rejectEscalationElevatedCount: number;
  rejectEscalationThrottleCount: number;
  rejectEscalationThrottleMs: number;
  rejectEscalationCriticalCount: number;
  desyncEscalationWindowMs: number;
  desyncEscalationCount: number;
  tickLagWarnWindowMs: number;
  tickLagCriticalWindowMs: number;
  tickLagPageWindowMs: number;
  tickLagWarnP95Ticks: number;
  tickLagCriticalP95Ticks: number;
  tickLagPageTicks: number;
  movementHeightSlackUnits: number;
  movementVelocitySlackPct: number;
}

export interface RuntimeIntegrityViolation {
  playerId: string | null;
  ruleId: string;
  category: IntegrityCategory;
  severity: IntegritySeverity;
  action: IntegrityAction;
  threshold: number | null;
  evidence: Record<string, unknown>;
  detectedAt: number;
}

export const DEFAULT_SESSION_INTEGRITY_CONFIG: SessionIntegrityConfig = Object.freeze({
  enabled: true,
  enforceInputEnvelope: true,
  enforceMovementInvariants: true,
  enforceIntentAge: true,
  enableRejectEscalation: true,
  enableDesyncEscalation: true,
  enableTickLagEscalation: true,
  maxIntentAgeMs: 250,
  rejectEscalationWindowMs: 10_000,
  rejectEscalationElevatedCount: 3,
  rejectEscalationThrottleCount: 6,
  rejectEscalationThrottleMs: 3_000,
  rejectEscalationCriticalCount: 10,
  desyncEscalationWindowMs: 8_000,
  desyncEscalationCount: 4,
  tickLagWarnWindowMs: 60_000,
  tickLagCriticalWindowMs: 20_000,
  tickLagPageWindowMs: 5_000,
  tickLagWarnP95Ticks: 1,
  tickLagCriticalP95Ticks: 3,
  tickLagPageTicks: 5,
  movementHeightSlackUnits: 0.18,
  movementVelocitySlackPct: 0.08,
});

export const INTEGRITY_RULE_IDS = Object.freeze({
  impossibleInputEnvelope: "INP-001",
  impossibleInputOutOfOrder: "INP-002",
  impossibleInputStale: "INP-003",
  impossibleInputBurst: "INP-004",
  impossibleMovementHeightDelta: "MOV-001",
  impossibleMovementVelocityDelta: "MOV-002",
  impossibleMovementPostElimMutation: "MOV-003",
  timeDriftTickLag: "TIM-001",
  timeDriftDesyncBurst: "TIM-002",
  timeDriftIntentAge: "TIM-003",
} as const);

export function resolveSessionIntegrityConfig(
  overrides: Partial<SessionIntegrityConfig> | undefined,
): SessionIntegrityConfig {
  if (!overrides) {
    return { ...DEFAULT_SESSION_INTEGRITY_CONFIG };
  }

  return {
    ...DEFAULT_SESSION_INTEGRITY_CONFIG,
    ...overrides,
  };
}
