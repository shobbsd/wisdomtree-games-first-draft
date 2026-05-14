# WIS-214: Game-Over + Rematch/Respawn Feedback Contract

## Objective
Guarantee deterministic game-over feedback and next-step routing so players never hit post-elimination dead-end states.

## Locked Contract Source
- Fixture: `docs/ux/WIS-214-game-over-rematch-feedback.fixture.json`
- Runtime contract: `src/ux/wis214-game-over-feedback-contract.ts`

## Scope
- Elimination transition copy contract:
  - impact headline
  - action helper copy
  - deterministic CTA outcome guidance
  - inactivity auto-route CTA label
- Post-match routing contract:
  - rematch/back-to-lobby/exit outcome guidance
  - blocked failure guidance copy before acknowledgement unlock

## Timing Lock
- `eliminationImpact`: `1200ms`
- `eliminationActionsTimeout`: `6000ms`

## Acceptance Checks
1. Elimination transition always exposes helper + outcome guidance copy.
2. Manual elimination CTA selection cancels inactivity auto-route immediately.
3. Post-match action payload includes guidance for rematch/respawn, lobby, and menu routes.
4. Failed-results ack gate returns explicit blocked-guidance copy until acknowledged.

## Evidence
- `tests/wis214-game-over-feedback-contract.test.ts`
- `tests/flow-state-contract.test.ts`
