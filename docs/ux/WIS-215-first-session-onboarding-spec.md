# WIS-215 First-Session Onboarding Cue Spec

## Objective
Provide contextual, first-session guidance for core match flow moments without blocking gameplay.

## Cue Coverage

| Cue ID | Trigger | Intent | Copy Source |
| --- | --- | --- | --- |
| `OB-QUEUE-FALLBACK` | `TS-CONNECT-FAILED` | Explain queue fallback CTAs (`Retry`, `Create Room`) to first-time players | `docs/ux/WIS-97-multiplayer-hud-leaderboard.fixture.json` |
| `OB-COUNTDOWN-READY` | `PM-COUNTDOWN` | Clarify readiness/countdown dependency and disconnect impact | `src/ux/wis97-critical-microcopy.ts` |
| `OB-HAZARD-URGENCY` | `HUD-ACTIVE` + rising-ground warning/critical state | Explain urgency escalation expectation for survival | `docs/multiplayer-state-ux-acceptance.fixture.json` |

## Behavior Rules

- Cues are per-player and one-time after acknowledgment.
- Cues are dismissible (`Got it`) and non-blocking.
- `HUD-ELIMINATED` suppresses all onboarding cues to avoid occluding elimination messaging.
- Cue order priority is fixed:
  1. `OB-QUEUE-FALLBACK`
  2. `OB-COUNTDOWN-READY`
  3. `OB-HAZARD-URGENCY`

## API Surface

- `RoomFlowState.uxState.onboarding` exposes active cue map per player:
  - `cueOrder`
  - `byPlayerId`
- `POST /v1/rooms/:sessionId/onboarding/ack` acknowledges cue for authenticated player and prevents replay.

## Verification

- Contract lock: `tests/wis215-first-session-onboarding-contract.test.ts`
- Runtime behavior: `tests/flow-state-contract.test.ts`
- Transport path: `tests/http-room-transport.test.ts`
