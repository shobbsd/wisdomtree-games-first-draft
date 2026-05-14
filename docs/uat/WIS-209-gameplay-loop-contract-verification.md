# WIS-209 Gameplay-Loop Contract Verification

Date: 2026-04-15 13:43:15 BST
Owner: Founding Engineer (`84764ae6-d553-4d01-a812-6deb1558098d`)

## Scope

Validation for rising-ground gameplay-loop contract lock:
- speed-curve behavior lock
- escalation/elimination ordering determinism lock
- elimination tie-break determinism lock

## Validation Commands + Outcomes

```bash
npm test -- tests/multiplayer-session.test.ts tests/wis135-rising-ground-contract.test.ts tests/wis209-rising-ground-determinism.test.ts
npm test -- tests/flow-state-contract.test.ts
npm test -- tests/wis135-rising-ground-contract.test.ts tests/wis209-rising-ground-determinism.test.ts tests/flow-state-contract.test.ts | tee .runtime/uat/WIS-209-validation.log
cat .runtime/uat/WIS-209-deterministic-sequence.log
```

Observed:
- `tests/multiplayer-session.test.ts`: **8 passed**
- `tests/wis135-rising-ground-contract.test.ts`: **2 passed**
- `tests/wis209-rising-ground-determinism.test.ts`: **3 passed**
- `tests/flow-state-contract.test.ts`: **19 passed**
- Combined WIS-209 contract suite: **24 passed, 0 failed**

Deterministic escalation output (from `.runtime/uat/WIS-209-deterministic-sequence.log`):

```text
expected-order: rg.state.normal.enter -> rg.state.warning.enter -> rg.state.critical.enter -> rg.elimination.triggered -> rg.elimination.actions_shown -> rg.elimination.auto_route
run1-order: rg.state.normal.enter -> rg.state.warning.enter -> rg.state.critical.enter -> rg.elimination.triggered -> rg.elimination.actions_shown -> rg.elimination.auto_route
run2-order: rg.state.normal.enter -> rg.state.warning.enter -> rg.state.critical.enter -> rg.elimination.triggered -> rg.elimination.actions_shown -> rg.elimination.auto_route
deterministic-match: true
```

## Acceptance Checklist (Contract Pass/Fail)

| Check | Status | Evidence |
|---|---|---|
| Canonical event names locked and present in runtime + tests | PASS | `src/ux/wis135-rising-ground-contract.ts`, `tests/wis135-rising-ground-contract.test.ts` |
| Exact escalation/elimination copy lock | PASS | `src/ux/wis135-rising-ground-contract.ts`, `docs/ux/WIS-135-rising-ground-escalation-elimination.fixture.json`, `tests/wis135-rising-ground-contract.test.ts` |
| Timing constants lock (1500/1800/1200/6000 + debounce) | PASS | `src/ux/wis135-rising-ground-contract.ts`, `docs/ux/WIS-135-rising-ground-escalation-elimination.fixture.json`, `tests/wis135-rising-ground-contract.test.ts` |
| Deterministic transition ordering (`normal -> warning -> critical -> eliminated -> actions -> auto-route`) | PASS | `tests/wis135-rising-ground-contract.test.ts`, `tests/wis209-rising-ground-determinism.test.ts`, `.runtime/uat/WIS-209-deterministic-sequence.log` |
| Jitter safety (warning/critical not skipped before elimination) | PASS | `tests/wis209-rising-ground-determinism.test.ts` |
| Speed-curve contract (acceleration + max-speed clamp) | PASS | `tests/multiplayer-session.test.ts` |
| Elimination determinism tie-break for simultaneous eliminations | PASS | `tests/wis209-rising-ground-determinism.test.ts` |
| Critical suppression + eliminated input lock + CTA ordering | PASS | `src/core/session-manager.ts`, `tests/flow-state-contract.test.ts`, `tests/wis135-rising-ground-contract.test.ts` |

## Runtime Artifacts For QA Rerun

- `.runtime/uat/WIS-209-validation.log`
- `.runtime/uat/WIS-209-deterministic-sequence.log`

## Files Added/Updated For WIS-209 Hardening

- `tests/multiplayer-session.test.ts`
- `tests/wis209-rising-ground-determinism.test.ts`
- `docs/uat/WIS-209-gameplay-loop-contract-verification.md`
