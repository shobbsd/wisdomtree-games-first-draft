# WIS-212: In-Run HUD Readability Hardening Under Late-Match Load

## Objective
Lock deterministic HUD readability constraints so urgent alerts, rank/survival fields, and toast replay stay legible under burst load on desktop and mobile minimum viewport profiles.

## Locked Contract Source
- Fixture: `docs/ux/WIS-212-hud-readability-stress.fixture.json`
- Runtime contract: `src/ux/wis212-hud-readability-contract.ts`

## Scope
- Layout safety between:
  - urgent alert lane (`P0/P1`)
  - critical HUD field lane (placement/rank/survival)
  - toast lane (`P2`)
- Deterministic queue/replay behavior during:
  - rapid rank churn
  - hazard preemption
  - reconnect toast replay
- Minimum viewport guarantees for desktop + mobile safe area.

## Viewport + Safe-Area Baseline
- `desktop_min`: `1280x720`, safe area `0/0/0/0`.
- `mobile_min`: `390x844`, safe area `top=47`, `bottom=34`, `left/right=0`.

## Typography + Spacing Locks
- Alert headline: `24/28`, `700`, letter spacing `0`.
- HUD critical field: `20/24`, `700`, letter spacing `0.2`.
- Toast body: `18/22`, `600`, letter spacing `0.1`.
- Spacing:
  - `safeAreaTopGapPx=8`
  - `horizontalPaddingPx=16`
  - `laneGapPx=12`
  - `alertLaneHeightPx=72`
  - `hudLaneHeightPx=88`
  - `toastLaneHeightPx=52`
  - `hudFieldGapPx=12`

## Readability Acceptance Criteria
1. Alert lane never overlaps or occludes critical HUD fields.
2. Toast lane always renders below HUD critical fields.
3. All lanes remain inside viewport safe-area bounds.
4. Placement/rank/survival min-width budget fits without truncation risk at minimum profiles.
5. Stacked urgency banners stay deterministic: `P0` preempts `P1`, then `P1` replays before queued `P2` toasts.
6. Under burst conditions, `P2` queue remains bounded to two newest items while `P0` hazard is active.
7. After `P0` dwell expires, queued warning/reconnect/rank toasts replay in deterministic priority + FIFO order.

## Deterministic Stress Tape
Scenario ID: `rank-churn-hazard-preemption-reconnect-replay`

Event timeline:
- `0ms`: `rank-up-4` (`P2`)
- `40ms`: `rank-down-5` (`P2`)
- `80ms`: `hazard-critical` (`P0`)
- `90ms`: `reconnect-success` (`P2`)
- `120ms`: `rank-up-3` (`P2`)

Expected behavior:
- Active during burst: `hazard-critical`
- Queued after burst: `["reconnect-success", "rank-up-3"]`
- Replay order after hazard dwell: `["reconnect-success", "rank-up-3"]`

Scenario ID: `stacked-urgency-banner-with-rank-churn`

Event timeline:
- `0ms`: `rank-up-4` (`P2`)
- `40ms`: `rank-down-5` (`P2`)
- `60ms`: `clearance-low` (`P1`)
- `80ms`: `hazard-critical` (`P0`)
- `90ms`: `reconnect-success` (`P2`)
- `120ms`: `rank-up-3` (`P2`)

Expected behavior:
- Active during burst: `hazard-critical`
- Queued after burst: `["clearance-low", "reconnect-success", "rank-up-3"]`
- Replay order after hazard dwell: `["clearance-low", "reconnect-success", "rank-up-3"]`

## Evidence
- `tests/wis212-hud-readability-contract.test.ts`
- `tests/priority-message-channel.test.ts`
