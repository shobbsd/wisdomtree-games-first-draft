import type { MessagePriority } from "./priority-message-channel.js";

export type Wis212ViewportProfileId = "desktop_min" | "mobile_min";

interface SafeAreaInsets {
  topPx: number;
  rightPx: number;
  bottomPx: number;
  leftPx: number;
}

interface HudLaneFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HudLaneFrames {
  alertLane: HudLaneFrame;
  hudLane: HudLaneFrame;
  toastLane: HudLaneFrame;
}

interface HudViewportProfile {
  id: Wis212ViewportProfileId;
  widthPx: number;
  heightPx: number;
  safeArea: SafeAreaInsets;
}

interface TypographyLockField {
  fontSizePx: number;
  lineHeightPx: number;
  fontWeight: number;
  letterSpacingPx: number;
}

interface TypographyLock {
  alertHeadline: TypographyLockField;
  hudCriticalField: TypographyLockField;
  toastBody: TypographyLockField;
}

interface SpacingLock {
  safeAreaTopGapPx: number;
  horizontalPaddingPx: number;
  laneGapPx: number;
  alertLaneHeightPx: number;
  hudLaneHeightPx: number;
  toastLaneHeightPx: number;
  hudFieldGapPx: number;
  criticalFieldMinWidthPx: {
    placement: number;
    rank: number;
    survivalTime: number;
  };
}

interface HudReadabilityEvaluation {
  profileId: Wis212ViewportProfileId;
  withinSafeArea: boolean;
  hasOverlap: boolean;
  hasOcclusion: boolean;
  hasTruncationRisk: boolean;
  availableCriticalFieldWidthPx: number;
  requiredCriticalFieldWidthPx: number;
}

interface Wis212StressEvent {
  readonly id: string;
  readonly state: string;
  readonly event: string;
  readonly priority: MessagePriority;
  readonly copy: string;
  readonly nowMs: number;
}

interface Wis212StressScenario {
  readonly id: string;
  readonly description: string;
  readonly queueLimit: {
    readonly p2MaxBuffered: number;
  };
  readonly events: readonly Wis212StressEvent[];
  readonly expected: {
    readonly hazardStartedAtMs: number;
    readonly activeDuringBurst: string;
    readonly queuedAfterBurst: readonly string[];
    readonly replayOrder: readonly string[];
  };
}

interface Wis212AcceptanceCheck {
  readonly id: string;
  readonly assertion: string;
}

export const WIS212_HUD_LAYOUT_PROFILES: Record<Wis212ViewportProfileId, HudViewportProfile> = Object.freeze({
  desktop_min: Object.freeze({
    id: "desktop_min",
    widthPx: 1280,
    heightPx: 720,
    safeArea: Object.freeze({
      topPx: 0,
      rightPx: 0,
      bottomPx: 0,
      leftPx: 0,
    }),
  }),
  mobile_min: Object.freeze({
    id: "mobile_min",
    widthPx: 390,
    heightPx: 844,
    safeArea: Object.freeze({
      topPx: 47,
      rightPx: 0,
      bottomPx: 34,
      leftPx: 0,
    }),
  }),
});

export const WIS212_HUD_TYPOGRAPHY_LOCK: TypographyLock = Object.freeze({
  alertHeadline: Object.freeze({
    fontSizePx: 24,
    lineHeightPx: 28,
    fontWeight: 700,
    letterSpacingPx: 0,
  }),
  hudCriticalField: Object.freeze({
    fontSizePx: 20,
    lineHeightPx: 24,
    fontWeight: 700,
    letterSpacingPx: 0.2,
  }),
  toastBody: Object.freeze({
    fontSizePx: 18,
    lineHeightPx: 22,
    fontWeight: 600,
    letterSpacingPx: 0.1,
  }),
});

export const WIS212_HUD_SPACING_LOCK: SpacingLock = Object.freeze({
  safeAreaTopGapPx: 8,
  horizontalPaddingPx: 16,
  laneGapPx: 12,
  alertLaneHeightPx: 72,
  hudLaneHeightPx: 88,
  toastLaneHeightPx: 52,
  hudFieldGapPx: 12,
  criticalFieldMinWidthPx: Object.freeze({
    placement: 104,
    rank: 104,
    survivalTime: 120,
  }),
});

export const WIS212_HUD_STRESS_SCENARIOS: readonly Wis212StressScenario[] = Object.freeze([
  Object.freeze({
    id: "rank-churn-hazard-preemption-reconnect-replay",
    description:
      "Rapid rank churn is preempted by a P0 hazard, then queued reconnect/rank updates replay in deterministic order.",
    queueLimit: Object.freeze({
      p2MaxBuffered: 2,
    }),
    events: Object.freeze([
      Object.freeze({
        id: "rank-up-4",
        state: "in_run.hud_active",
        event: "rank_improved",
        priority: "P2",
        copy: "Rank Up: #4",
        nowMs: 0,
      }),
      Object.freeze({
        id: "rank-down-5",
        state: "in_run.hud_active",
        event: "rank_dropped",
        priority: "P2",
        copy: "Rank Down: #5",
        nowMs: 40,
      }),
      Object.freeze({
        id: "hazard-critical",
        state: "in_run.urgent_alert",
        event: "ground_speed_threshold_2",
        priority: "P0",
        copy: "Critical Rise Speed",
        nowMs: 80,
      }),
      Object.freeze({
        id: "reconnect-success",
        state: "in_run.hud_active",
        event: "reconnect_success_in_grace",
        priority: "P2",
        copy: "Reconnected",
        nowMs: 90,
      }),
      Object.freeze({
        id: "rank-up-3",
        state: "in_run.hud_active",
        event: "rank_improved",
        priority: "P2",
        copy: "Rank Up: #3",
        nowMs: 120,
      }),
    ]),
    expected: Object.freeze({
      hazardStartedAtMs: 80,
      activeDuringBurst: "hazard-critical",
      queuedAfterBurst: ["reconnect-success", "rank-up-3"],
      replayOrder: ["reconnect-success", "rank-up-3"],
    }),
  }),
  Object.freeze({
    id: "stacked-urgency-banner-with-rank-churn",
    description:
      "P1 urgency stacks under P0 hazard while rank churn continues; post-hazard replay preserves priority then FIFO ordering.",
    queueLimit: Object.freeze({
      p2MaxBuffered: 2,
    }),
    events: Object.freeze([
      Object.freeze({
        id: "rank-up-4",
        state: "in_run.hud_active",
        event: "rank_improved",
        priority: "P2",
        copy: "Rank Up: #4",
        nowMs: 0,
      }),
      Object.freeze({
        id: "rank-down-5",
        state: "in_run.hud_active",
        event: "rank_dropped",
        priority: "P2",
        copy: "Rank Down: #5",
        nowMs: 40,
      }),
      Object.freeze({
        id: "clearance-low",
        state: "in_run.warning_alert",
        event: "clearance_low_warning",
        priority: "P1",
        copy: "Low Clearance",
        nowMs: 60,
      }),
      Object.freeze({
        id: "hazard-critical",
        state: "in_run.urgent_alert",
        event: "ground_speed_threshold_2",
        priority: "P0",
        copy: "Critical Rise Speed",
        nowMs: 80,
      }),
      Object.freeze({
        id: "reconnect-success",
        state: "in_run.hud_active",
        event: "reconnect_success_in_grace",
        priority: "P2",
        copy: "Reconnected",
        nowMs: 90,
      }),
      Object.freeze({
        id: "rank-up-3",
        state: "in_run.hud_active",
        event: "rank_improved",
        priority: "P2",
        copy: "Rank Up: #3",
        nowMs: 120,
      }),
    ]),
    expected: Object.freeze({
      hazardStartedAtMs: 80,
      activeDuringBurst: "hazard-critical",
      queuedAfterBurst: ["clearance-low", "reconnect-success", "rank-up-3"],
      replayOrder: ["clearance-low", "reconnect-success", "rank-up-3"],
    }),
  }),
]);

export const WIS212_HUD_ACCEPTANCE_CHECKS: readonly Wis212AcceptanceCheck[] = Object.freeze([
  Object.freeze({
    id: "HUD-READ-01",
    assertion: "Critical alert lane never overlaps rank/survival HUD lane on desktop and mobile minimum viewports.",
  }),
  Object.freeze({
    id: "HUD-READ-02",
    assertion: "Toast lane remains below HUD critical fields and inside safe-area bounds at minimum viewport profiles.",
  }),
  Object.freeze({
    id: "HUD-READ-03",
    assertion: "Placement, rank, and survival fields fit locked min-width budget without truncation at minimum viewports.",
  }),
  Object.freeze({
    id: "HUD-READ-04",
    assertion:
      "Stacked urgency behavior stays deterministic: P0 hazard preempts P1 warning, then warning replays before queued P2 toasts.",
  }),
  Object.freeze({
    id: "HUD-READ-05",
    assertion: "Burst scenarios keep queue bounded to two newest P2 items while P0 hazard is active.",
  }),
  Object.freeze({
    id: "HUD-READ-06",
    assertion: "After hazard dwell ends, queued warning/reconnect/rank toasts replay in deterministic priority+FIFO order.",
  }),
]);

export function resolveHudLaneFrames(profileId: Wis212ViewportProfileId): HudLaneFrames {
  const profile = WIS212_HUD_LAYOUT_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown WIS-212 viewport profile: ${profileId}`);
  }

  const horizontalPadding = WIS212_HUD_SPACING_LOCK.horizontalPaddingPx;
  const startX = profile.safeArea.leftPx + horizontalPadding;
  const laneWidth = profile.widthPx - profile.safeArea.leftPx - profile.safeArea.rightPx - horizontalPadding * 2;
  const startY = profile.safeArea.topPx + WIS212_HUD_SPACING_LOCK.safeAreaTopGapPx;

  const alertLane: HudLaneFrame = {
    x: startX,
    y: startY,
    width: laneWidth,
    height: WIS212_HUD_SPACING_LOCK.alertLaneHeightPx,
  };

  const hudLane: HudLaneFrame = {
    x: startX,
    y: alertLane.y + alertLane.height + WIS212_HUD_SPACING_LOCK.laneGapPx,
    width: laneWidth,
    height: WIS212_HUD_SPACING_LOCK.hudLaneHeightPx,
  };

  const toastLane: HudLaneFrame = {
    x: startX,
    y: hudLane.y + hudLane.height + WIS212_HUD_SPACING_LOCK.laneGapPx,
    width: laneWidth,
    height: WIS212_HUD_SPACING_LOCK.toastLaneHeightPx,
  };

  return {
    alertLane,
    hudLane,
    toastLane,
  };
}

export function evaluateHudReadability(profileId: Wis212ViewportProfileId): HudReadabilityEvaluation {
  const profile = WIS212_HUD_LAYOUT_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown WIS-212 viewport profile: ${profileId}`);
  }

  const frames = resolveHudLaneFrames(profileId);
  const hasOverlap =
    lanesOverlap(frames.alertLane, frames.hudLane) ||
    lanesOverlap(frames.alertLane, frames.toastLane) ||
    lanesOverlap(frames.hudLane, frames.toastLane);
  const hasOcclusion = lanesOverlap(frames.hudLane, frames.alertLane) || lanesOverlap(frames.hudLane, frames.toastLane);

  const safeMinX = profile.safeArea.leftPx;
  const safeMaxX = profile.widthPx - profile.safeArea.rightPx;
  const safeMinY = profile.safeArea.topPx;
  const safeMaxY = profile.heightPx - profile.safeArea.bottomPx;
  const withinSafeArea = [frames.alertLane, frames.hudLane, frames.toastLane].every(
    (lane) =>
      lane.x >= safeMinX &&
      lane.y >= safeMinY &&
      lane.x + lane.width <= safeMaxX &&
      lane.y + lane.height <= safeMaxY,
  );

  const requiredCriticalFieldWidthPx =
    WIS212_HUD_SPACING_LOCK.criticalFieldMinWidthPx.placement +
    WIS212_HUD_SPACING_LOCK.criticalFieldMinWidthPx.rank +
    WIS212_HUD_SPACING_LOCK.criticalFieldMinWidthPx.survivalTime +
    WIS212_HUD_SPACING_LOCK.hudFieldGapPx * 2;
  const availableCriticalFieldWidthPx = frames.hudLane.width;
  const hasTruncationRisk = availableCriticalFieldWidthPx < requiredCriticalFieldWidthPx;

  return {
    profileId,
    withinSafeArea,
    hasOverlap,
    hasOcclusion,
    hasTruncationRisk,
    availableCriticalFieldWidthPx,
    requiredCriticalFieldWidthPx,
  };
}

function lanesOverlap(left: HudLaneFrame, right: HudLaneFrame): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
