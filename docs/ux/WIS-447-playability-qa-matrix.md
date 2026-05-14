# WIS-447 Playability QA Matrix

Run timestamp (UTC): `2026-04-22T09:24:18Z`  
Workspace commit: `c606883d65bba6b276cd22a11728a8860606d7b7`

Parent: [WIS-442](/WIS/issues/WIS-442)  
Dependency closeout consumed: [WIS-444](/WIS/issues/WIS-444) (`done`), evidence comment [9ae630ac](/WIS/issues/WIS-444#comment-9ae630ac-4883-4f3f-a22e-c4091d7c6666)

## Scenario Pass/Fail Matrix

| Scenario ID | Required playability scope | Command / validation path | Result | Evidence |
| --- | --- | --- | --- | --- |
| `LOOP-01` | board-playable loop runs from session start to round finalization | `PLAYABLE_AUTO=1 PLAYABLE_TICK_MS=50 PLAYABLE_MAX_TICKS=12 npm run play` | PASS (terminal loop completed) | `docs/ux/evidence/WIS-447-playability-qa-test-run.log` (`playable_loop_auto`) |
| `RISE-01` | rising-ground progression clarity/fairness remains stable during active loop | speed trace from `x1.01` to `x1.14`, monotonic non-decreasing across 12 ticks | PASS | `docs/ux/evidence/WIS-447-playability-qa-test-run.log` (`playable_loop_auto`) |
| `LB-01` | live leaderboard freshness and legibility during match + post-round | `Live Standings` updates every tick; `Global Leaderboard` emitted on round complete | PASS | `docs/ux/evidence/WIS-447-playability-qa-test-run.log` (`playable_loop_auto`) |
| `A11Y-01` | accessibility baseline + critical microcopy regressions remain guarded | `npm test -- tests/wis212-hud-readability-contract.test.ts tests/wis216-accessibility-baseline-contract.test.ts tests/wis97-critical-microcopy-lock.test.ts` | PASS (3 files, 7 tests) | `docs/ux/evidence/WIS-447-playability-qa-test-run.log` (`accessibility_contracts`) |
| `REG-01` | broad regression sanity after playability execution | `npm test` + `npm run build` | PASS (17 files, 80 tests; build green) | `docs/ux/evidence/WIS-447-playability-qa-test-run.log` (`full_regression_suite`, `build_gate`) |
| `SURFACE-01` | board scope requires desktop + mobile playable surface evidence | validated available runtime surface and dependency closeout note | FAIL (blocker) | [WIS-444 closeout](/WIS/issues/WIS-444#comment-9ae630ac-4883-4f3f-a22e-c4091d7c6666) notes terminal-first only |

## Defect Triage

- Blocker `B1`: desktop/mobile FE playable surface evidence missing; only terminal playable path currently demonstrated.
- Follow-up assigned: [WIS-448](/WIS/issues/WIS-448) to FE owner for desktop/mobile evidence package.
- Non-blocking observation: npm emits local env warnings (`auto-install-peers`, `recursive`) during runs; no functional regression observed in matrix scope.

## Gate Decision

- Matrix verdict: **FAIL**
- Reason: terminal playability, rising-ground progression, leaderboard freshness, accessibility contracts, and regression gates all pass; board-required desktop/mobile playable evidence remains missing.
- Resume condition: [WIS-448](/WIS/issues/WIS-448) posts desktop/mobile evidence and residual-risk note back to [WIS-447](/WIS/issues/WIS-447).
