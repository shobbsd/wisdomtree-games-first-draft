# WIS-516 Server-Side Integrity + Impossible-Input Detection Prep Spec

Date: 2026-04-24
Owner: Senior Multiplayer/Backend Engineer (`WIS-516`)
Status: `done` (constants lock integrated from [WIS-514](/WIS/issues/WIS-514))

## Blocker and Unblock Input

Dependency unblock completed at `2026-04-24T10:28:22Z` after WIS-514 published final timing/integrity constants in `timing-tolerance-constants` revision `2`.

## WIS-514 Reconciliation Diff (2026-04-24)

Source artifact: [timing-tolerance-constants](/WIS/issues/WIS-514#document-timing-tolerance-constants)

Applied decisions:

- Hard enforcement scope is aligned for exploit/impossible-input boundaries (`INP-001/002/003`, token/replay/expiry/mismatch classes).
- Soft alert scope is aligned for latency/SLO distribution thresholds (`TIM-001`, allocator/join-to-spawn distribution targets).

Rules/constants changed from provisional baseline:

- `INTENT_MAX_AGE_MS`: `2500ms -> 250ms`
- `INPUT_REJECT_ESCALATION`: lock `10_000ms` window with `warn >=3`, `throttle >=6` (`3_000ms`), `quarantine >=10`
- `DESYNC_BURST_ESCALATION`: lock `8_000ms` window and `>=4` threshold; side effects now include ranking freeze + resync checkpoint requirement
- `TICK_LAG_ALERT_POLICY`: replace ms/count policy with tick-based sustained windows: warn `p95 > 1` for `60_000ms`, critical `p95 > 3` for `20_000ms`, page `lag > 5 ticks` for `5_000ms`
- `MOVEMENT_INVARIANT_SLACK`: `height 0.05 -> 0.18`, `velocity 0.05 -> 0.08`

Ambiguous decision keys requiring owner response:

- none

## Objective

Add server-only integrity checks that detect impossible movement/input/time behavior without trusting client state and without regressing leaderboard correctness.

## Integrity Rule Catalog

| Rule ID | Category | Detection (authoritative only) | Enforcement | Telemetry severity |
| --- | --- | --- | --- | --- |
| `INP-001` | impossible input | input `thrust` is non-finite or outside `[-1, 1]` before clamp | reject input | `warn` |
| `INP-002` | impossible input | input sequence jump (`sequence > lastInputSequence + 1`) | reject input (`out_of_order`) | `warn` |
| `INP-003` | impossible input | stale replay (`sequence <= lastInputSequence`) | reject input (`stale`) | `warn` |
| `INP-004` | impossible input | repeated rejected inputs exceed burst threshold in rolling window | throttle non-critical intents at `>=6/10s` then quarantine player at `>=10/10s` | `elevated` / `critical` |
| `MOV-001` | impossible movement | per-tick `heightDelta` exceeds kinematic cap from server gravity/thrust envelope | quarantine session tick and flag integrity | `critical` |
| `MOV-002` | impossible movement | per-tick `velocityDelta` exceeds acceleration cap from authoritative constants | quarantine session tick and flag integrity | `critical` |
| `MOV-003` | impossible movement | illegal state transition after elimination (`isEliminated=true` with non-zero thrust/velocity changes) | force sanitize player state | `critical` |
| `TIM-001` | time drift | authoritative tick lag percentile breach sustained beyond drift budget window | keep sim authoritative + emit SLO/integrity breach | `elevated` |
| `TIM-002` | time drift | repeated `session.sync.desync_detected` for same player/session over escalation window | quarantine player input + freeze ranking side effects + require authoritative resync checkpoint | `elevated` |
| `TIM-003` | time drift | intent age exceeds max acceptable replay age at process tick | drop intent as stale-time input | `warn` |

## Authoritative Validation Points (Implementation Paths)

1. `src/core/multiplayer-session.ts`
- `submitInput(...)`: add strict input envelope guard (`INP-001`) before sequence/rate processing and return explicit integrity rejection reason.
- `submitInput(...)`: add rolling rejected-input counters per player (`INP-004`) with monotonic timestamps.
- `tick(...)`: add kinematic invariant assertions after integration (`MOV-001`, `MOV-002`, `MOV-003`).
- add helper `validateKinematicInvariants(before, after, deltaMs)` that returns violation records.

2. `src/core/session-manager.ts`
- `submitInput(...)`: map integrity rejection reasons to new telemetry envelope and escalation state.
- `advanceRoom(...)`: aggregate movement/time-drift violations per tick and emit integrity telemetry.
- add session-level rolling violation windows and escalation state machine (`warn -> elevated -> critical`).

3. `src/core/authoritative-match-session-service.ts`
- `processTick(...)`: enforce intent age cutoff (`TIM-003`) before forwarding to `SessionManager.submitInput`.
- `appendLog(...)` payload: include integrity rejection reason for deterministic replay evidence.

4. `src/transport/http-room-transport.ts`
- `validateSyncAnchor(...)`: keep existing desync gating and add repeated-desync escalation marker (`TIM-002`) using session-manager integrity APIs.

5. `src/contracts/wis511-session-identity-event-schema-registry.ts`
- register `session.integrity.violation.v1` payload schema.
- register `session.integrity.escalated.v1` payload schema.
- include validators for the above in `WIS511_EVENT_SCHEMAS`.

## Violation Telemetry Contract

Event: `session.integrity.violation`

Required fields:

- `sessionId`
- `playerId` (`null` allowed for session-scoped breaches)
- `ruleId`
- `category` (`input`, `movement`, `time_drift`)
- `severity` (`warn`, `elevated`, `critical`)
- `action` (`reject_input`, `sanitize_state`, `quarantine_player`, `quarantine_session`, `observe_only`)
- `tick`
- `revision`
- `detectedAt`
- `evidence` (rule-specific bounded object)
- `threshold` (configured threshold at detection time)
- `windowCount` (violations in rolling window)

Event: `session.integrity.escalated`

Required fields:

- `sessionId`
- `playerId` (`null` allowed)
- `fromSeverity`
- `toSeverity`
- `triggerRuleId`
- `windowStartMs`
- `windowEndMs`
- `violationCount`
- `escalatedAt`

## Escalation Threshold Defaults (Locked)

- `warn`: any single violation for `INP-001/002/003/004` or `TIM-003`
- `elevated`: input-reject burst `>= 6` in `10_000ms` (throttle window)
- `critical`: input-reject burst `>= 10` in `10_000ms`, any `MOV-*` violation, or desync burst `>= 4` in `8_000ms`

## False-Positive Mitigation Notes

- Keep input escalation staged (`warn -> throttle -> quarantine`) to avoid immediate hard lock on transient packet jitter.
- Use sustained tick-lag windows (`60s/20s/5s`) so `TIM-001` alerting does not trigger on one-off spikes.
- Gate desync-burst quarantine release on a matching authoritative sync checkpoint (`validateSyncAnchor` success path).
- Keep rejection reasons deterministic and bounded; never derive integrity decisions from client-provided state hashes alone.
- Require score-parity regression checks (clean vs tampered tape) in CI before enabling hard-quarantine by default.

## Observability Queries

1. Top integrity rules by violation count (15m)

```sql
SELECT ruleId, category, severity, COUNT(*) AS violations
FROM telemetry_events
WHERE type = 'session.integrity.violation'
  AND detectedAt >= NOW() - INTERVAL '15 minutes'
GROUP BY ruleId, category, severity
ORDER BY violations DESC;
```

2. Sessions hitting elevated/critical escalation in last hour

```sql
SELECT sessionId, playerId, toSeverity, COUNT(*) AS escalations
FROM telemetry_events
WHERE type = 'session.integrity.escalated'
  AND escalatedAt >= NOW() - INTERVAL '1 hour'
GROUP BY sessionId, playerId, toSeverity
HAVING COUNT(*) > 0
ORDER BY escalations DESC;
```

3. Potential false positives (violations without gameplay impact)

```sql
SELECT v.ruleId, COUNT(*) AS candidateFalsePositives
FROM telemetry_events v
LEFT JOIN telemetry_events r
  ON r.sessionId = v.sessionId
 AND r.type = 'session.input.rejected'
 AND r.timestamp BETWEEN v.detectedAt - 1000 AND v.detectedAt + 1000
WHERE v.type = 'session.integrity.violation'
  AND v.severity = 'warn'
  AND r.id IS NULL
GROUP BY v.ruleId
ORDER BY candidateFalsePositives DESC;
```

## Rule Implementation Path + Test Case Matrix

| Rule ID | Primary implementation path | Required tests |
| --- | --- | --- |
| `INP-001` | `src/core/multiplayer-session.ts#submitInput` | `tests/multiplayer-session.test.ts`: reject non-finite and out-of-range thrust with integrity reason |
| `INP-002` | `src/core/multiplayer-session.ts#submitInput` | `tests/multiplayer-session.test.ts`: contiguous sequence enforcement remains deterministic |
| `INP-003` | `src/core/multiplayer-session.ts#submitInput` | `tests/multiplayer-session.test.ts`: replayed sequence rejected as stale |
| `INP-004` | `src/core/session-manager.ts#submitInput` | `tests/flow-state-contract.test.ts`: repeated rejects emit escalation after threshold |
| `MOV-001` | `src/core/multiplayer-session.ts#tick` | `tests/multiplayer-session.test.ts`: kinematic cap breach emits critical violation |
| `MOV-002` | `src/core/multiplayer-session.ts#tick` | `tests/multiplayer-session.test.ts`: acceleration cap breach path |
| `MOV-003` | `src/core/multiplayer-session.ts#tick` | `tests/flow-state-contract.test.ts`: eliminated player cannot regain active movement state |
| `TIM-001` | `src/core/session-manager.ts#advanceRoom` | `tests/flow-state-contract.test.ts`: sustained lag drives escalation event |
| `TIM-002` | `src/transport/http-room-transport.ts#validateSyncAnchor` + `SessionManager.recordSyncDesync` | `tests/http-room-transport.test.ts`: repeated desync emits escalation and player-scoped quarantine signal |
| `TIM-003` | `src/core/authoritative-match-session-service.ts#processTick` | `tests/authoritative-match-session-service.test.ts`: stale intent-age dropped and logged deterministically |

## Release Reliability Gate Additions

Before closing WIS-516:

- pass all rule-path tests in matrix above
- pass score-parity no-inflation regression (`clean` vs `tampered` tapes)
- pass replay determinism (`replayAuthoritativeMatchSessionLog`) with integrity events included
- validate new telemetry schemas in `WIS511_EVENT_SCHEMAS`
