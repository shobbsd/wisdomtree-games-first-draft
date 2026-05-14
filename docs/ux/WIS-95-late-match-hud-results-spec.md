# WIS-95: Late-Match HUD Readability + Results Degraded-State UX Spec

## Objective
Lock one FE-ready UX package for late-match readability, elimination handoff, and results degraded-state behavior.

## Inputs and Alignment
- Onboarding/control hint baseline: [WIS-93](/WIS/issues/WIS-93)
- Degraded leaderboard behavior baseline: [WIS-91](/WIS/issues/WIS-91)
- Hardening/runtime context: [WIS-82](/WIS/issues/WIS-82)

## Scope
- In-match HUD during final phase of a round.
- Elimination transition from authoritative elimination to next action.
- Results/leaderboard lifecycle in `normal`, `pending`, `retrying`, `failed` states.

Late-match window starts when either condition is true:
- `matchProgress >= 0.80`
- `timeRemainingMs <= 30000`

## High-Speed HUD Alert Priority Matrix

| Alert ID | Trigger condition | Exact copy | Priority | Can interrupt | Suppresses while active | Exit condition |
|---|---|---|---|---|---|---|
| `HUD-ELIMINATED` | `player_eliminated` authoritative event | `Eliminated` | P0 | Any state | All lower states and queued toasts | Elimination action panel shown |
| `HUD-JUMP-NOW` | projected elimination `< 3000ms` | `Jump Now` | P0 | Any state except `HUD-ELIMINATED` | P1 + P2 | Risk de-escalates below urgent threshold or elimination commits |
| `HUD-CRITICAL-RISE` | `ground_speed_threshold_2` | `Critical Rise Speed` | P0 | P1 + P2 | P1 + P2 | Falls below threshold 2 or replaced by newer P0 |
| `HUD-LOW-CLEARANCE` | `clearance_low_warning` | `Low Clearance` | P1 | P2 only | P2 | Risk clears or escalates to P0 |
| `HUD-RANK-UP` | rank improves | `Rank Up: #{newRank}` | P2 | none | none | Toast dwell elapsed (1.5s) |
| `HUD-RANK-DOWN` | rank drops | `Rank Down: #{newRank}` | P2 | none | none | Toast dwell elapsed (1.5s) |

### Conflict Resolution Rules
- Only one banner (P0/P1) and one toast lane (P2) may render at a time.
- Newest P0 replaces current P0 immediately.
- P2 toasts queue max `2`; on overflow, keep the two newest and drop the oldest.
- While any P0 is active, do not render P2 toasts; replay queued P2 toasts only after P0 clears.
- `HUD-ELIMINATED` clears all queued toasts and ends further HUD alert churn for this round.

## Screen State Tables

### A) Late-Match HUD

| State | Trigger condition | UI text (exact) | UI treatment | Exit condition |
|---|---|---|---|---|
| `HUD-NORMAL` | Late-match window entered with no active warnings | none | Standard HUD chrome; rank widget readable at locked high-contrast style | Any alert trigger below |
| `HUD-RANK-DELTA` | Rank up/down event and no active P0/P1 | `Rank Up: #{newRank}` or `Rank Down: #{newRank}` | Under-HUD toast, 1.5s dwell | Dwell elapsed or interrupted by P0/P1 |
| `HUD-LOW-CLEARANCE` | Low clearance warning and no active P0 | `Low Clearance` | Warning banner in alert stack | Warning clears or escalates to P0 |
| `HUD-CRITICAL` | Threshold-2 rise warning | `Critical Rise Speed` | P0 top banner | De-escalation or newer P0 |
| `HUD-JUMP-NOW` | Elimination imminent (`< 3000ms`) | `Jump Now` | P0 top banner, highest non-terminal urgency | Risk de-escalation or elimination |
| `HUD-ELIMINATED` | Authoritative elimination commit | `Eliminated` | P0 terminal banner + gameplay lock | `ELIM-IMPACT` enters |

### B) Elimination Transition

| State | Trigger condition | UI text (exact) | UI treatment | Exit condition |
|---|---|---|---|---|
| `ELIM-IMPACT` | `player_eliminated` committed | `Eliminated` | 1.2s impact state; controls locked | 1200ms elapsed |
| `ELIM-ACTIONS` | `ELIM-IMPACT` timeout | `You can spectate now or view results.` | Action panel with CTAs: `View Results` (primary), `Spectate` (secondary) | CTA selected or auto-route timeout |
| `ELIM-AUTO-RESULTS` | No input during `ELIM-ACTIONS` for 6000ms | `View Results` | Auto-route to results; no extra modal | Results screen mounted |

### C) Results + Leaderboard Commit

| State | Trigger condition | UI text (exact) | UI treatment | Exit condition |
|---|---|---|---|---|
| `RESULTS-NORMAL` | `leaderboard_commit_succeeded` (first try or after recovery) | `Final Placement: #{placement}` | Standard results card, no degraded banner | New match starts or view exits |
| `RESULTS-PENDING` | `leaderboard_commit_started` and unresolved for >400ms | `Saving your match result...` | Info banner in results status slot | `RESULTS-NORMAL`, `RESULTS-RETRYING`, or `RESULTS-FAILED` |
| `RESULTS-RETRYING` | `leaderboard_commit_retry_scheduled` | `Sync issue detected. Retrying leaderboard save ({attempt}/{maxAttempts})...` | Warning banner in status slot | Success, terminal failure, or delayed variant |
| `RESULTS-FAILED` | `leaderboard_commit_failed_terminal` | `Leaderboard sync failed for now. We will keep retrying in the background.` | Blocking inline error alert with `OK` and `View details` | User acknowledges; background reconcile success clears state |

Retrying delayed variant (same state, escalated copy):
- Trigger: unresolved retry lifecycle >5000ms.
- Copy swap: `Still syncing leaderboard. Your result is safe and will appear soon.`

Recovery confirmation:
- Trigger: success after `RESULTS-RETRYING` or `RESULTS-FAILED` passive chip.
- Toast copy: `Leaderboard synced. Your placement is now confirmed.`
- Duration: 4000ms.

## Rematch CTA Behavior by Commit State

| Commit state | `Play Again` | `Back to Lobby` | `Exit to Menu` |
|---|---|---|---|
| `RESULTS-NORMAL` | Immediate route; no warning | Immediate route | Immediate route |
| `RESULTS-PENDING` | Allowed immediately; carry `syncPending` chip to next screen | Allowed immediately; carry chip | Allowed immediately; carry chip |
| `RESULTS-RETRYING` | Allowed immediately; carry chip and attempt counter context | Allowed immediately; carry chip | Allowed immediately; carry chip |
| `RESULTS-FAILED` | Allowed only after user presses `OK` once on failure alert; then carry passive `Sync pending` chip | Same as Play Again | Same as Play Again |

## Timing Rules (Locked)
- Rank toast dwell: `1500ms`
- `ELIM-IMPACT` duration: `1200ms`
- `ELIM-ACTIONS` auto-route timeout: `6000ms`
- Pending anti-flicker threshold: `400ms`
- Retrying delayed-copy threshold: `5000ms`
- Recovery toast dwell: `4000ms`

## Accessibility Rules (Required)
- Non-color-only signaling for all alert states (icon + text label + body copy).
- `aria-live="assertive"` for `HUD-JUMP-NOW`, `HUD-ELIMINATED`, and `RESULTS-FAILED` first render.
- `aria-live="polite"` for `RESULTS-PENDING`, `RESULTS-RETRYING`, and recovery toast.
- Minimum contrast: text `>= 4.5:1`, non-text indicators `>= 3:1`.
- If `prefers-reduced-motion`, use opacity transitions only (<=150ms), no pulse animation.

## FE-Ready Acceptance Checklist (Must/Should)

| Screen state | Must | Should |
|---|---|---|
| `HUD-NORMAL` | Preserve readable rank/survival UI in late-match window with no overlap collisions. | Keep rank widget layout stable under rapid state changes. |
| `HUD-RANK-DELTA` | Show exact rank copy and enforce 1.5s dwell with queue max 2. | Drop oldest queued toast on overflow rather than blocking new data. |
| `HUD-LOW-CLEARANCE` | Render warning banner only when no active P0. | Use same anchor position across desktop/mobile with safe-area offsets. |
| `HUD-CRITICAL` | Preempt P1/P2 immediately and display exact copy. | Restore queued P2 toast(s) after P0 clears. |
| `HUD-JUMP-NOW` | Always preempt lower priorities and announce assertively. | Include countdown indicator when projection data is available. |
| `HUD-ELIMINATED` | Clear alert queues and lock controls instantly. | Keep elimination banner visible until `ELIM-IMPACT` completes. |
| `ELIM-IMPACT` | Show immediate elimination feedback for 1.2s with no user action required. | Use subtle camera/UI shake only when reduced-motion is off. |
| `ELIM-ACTIONS` | Present `View Results` and `Spectate` CTAs with exact helper copy. | Preserve focus order: heading -> primary CTA -> secondary CTA. |
| `ELIM-AUTO-RESULTS` | Auto-route to results after 6s inactivity. | Cancel auto-route instantly if user selects a CTA first. |
| `RESULTS-NORMAL` | Render final placement and rematch CTAs without degraded banner. | Show recovery toast if state came from retry/failure path. |
| `RESULTS-PENDING` | Show pending copy only after 400ms unresolved commit. | Keep CTA row enabled while pending. |
| `RESULTS-RETRYING` | Show retrying copy with `{attempt}/{maxAttempts}` token. | Swap to delayed variant after 5s unresolved without changing state ID. |
| `RESULTS-FAILED` | Block with failure alert until first `OK`, then permit rematch with passive `Sync pending` chip. | Expose `View details` diagnostics panel without blocking rematch route. |

## FE/CTO Handoff Notes
- Keep one FE state machine for HUD + elimination + results commit states; avoid per-component toggle logic.
- Reuse [WIS-91] degraded copy verbatim to avoid cross-screen wording drift.
- Telemetry to emit for validation: `hud_alert_state_changed`, `elimination_transition_state_changed`, `results_commit_state_changed`, `results_rematch_action_with_commit_state`.

## Open Decisions
None.
