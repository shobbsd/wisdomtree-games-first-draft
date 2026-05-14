# WIS-65 Implementation Note

## Architecture Decisions

1. **Authoritative simulation lives server-side in `MultiplayerSession`.**
   - Ground-rise, elimination, and input-order enforcement are all single-source-of-truth on the server model.
   - Session snapshots include deterministic `stateHash` for reconciliation gate enforcement.

2. **Session orchestration is isolated in `SessionManager`.**
   - Room creation/join/advance/complete concerns are separate from the simulation internals.
   - Completion converts authoritative session data into leaderboard-ready match records.

3. **Leaderboard is write-path first and in-memory for baseline speed.**
   - `LeaderboardService` keeps best score per player and exposes sorted standings.
   - Write events emit telemetry for downstream integrity/audit pipelines.

4. **Observability baseline is event-driven.**
   - `InMemoryEventSink` records lifecycle, input acceptance/rejection, and leaderboard writes.
   - This is intentionally simple but gives immediate signal quality for local iteration.

## WIS-78 Hardening Update (2026-04-13)

1. **Reconnect token integrity and replay rejection**
   - Reconnect tokens are now HMAC-signed (`sid`, `pid`, `exp`, `jti`) and validated server-side.
   - Token state is explicit: `active` -> `consumed` (successful reconnect) or `expired` (timeout/elimination).
   - Replay attempts against consumed tokens are rejected with `token_replayed`; expired tokens resolve as `token_expired`.

2. **Input abuse limits and rejection telemetry**
   - `MultiplayerSession` enforces fixed-window input limits for both player and room scopes.
   - Rejections include explicit reasons: `rate_limited_player` / `rate_limited_room`.
   - `SessionManager` now emits `session.input.rate_limited` telemetry with scope to support anti-abuse monitoring.

3. **Authoritative scoring guardrails**
   - Match score remains server-authoritative and derived only from simulation state (`survivalMs`, `height`, elimination penalty).
   - Tampered input sequences are rejected and cannot directly alter score computation.
   - Contract coverage includes regression tests that compare clean vs tampered input paths and assert score parity.

## WIS-79 Hardening Update (2026-04-13)

1. **Tick-lag SLO instrumentation**
   - `SessionManager.advanceRoom` now emits `session.slo.tick_lag` on every tick.
   - Payload includes `lagMs`, rolling `p95LagMs`, rolling `p99LagMs`, and `sampleSize`.
   - Lag is measured as scheduling drift from expected tick cadence (`lastAdvanceAtMs + deltaMs`).

2. **Reconnect success-rate instrumentation**
   - `SessionManager.reconnectPlayer` now emits `session.slo.reconnect_success_rate` on every attempt.
   - Payload includes `attempts`, `successes`, `failures`, `successRate`, and `reasonBreakdown`.
   - Reconnect metric payload carries `reconnectWindowMs`; MVP remains locked to `30_000ms` unless explicitly overridden by room config.

3. **Leaderboard write latency + failure-rate instrumentation**
   - `LeaderboardService.recordMatchResult` now emits `leaderboard.slo.write_latency` for both success and failure paths.
   - Payload includes `latencyMs`, rolling `p95LatencyMs`, rolling `p99LatencyMs`, `attempts`, `failures`, and `failureRate`.
   - Failure metrics emit in a `finally` block to guarantee observability even when write ingestion throws.

## WIS-80 Hardening Update (2026-04-13)

1. **Durable event-first persistence (single-node MVP)**
   - Added `FileDurableStateStore` with atomic file writes to persist room snapshots and match-final events.
   - Durable payload now tracks `sessionSnapshots` and `matchFinalEvents` by stable `eventId`.

2. **Session snapshot durability**
   - `SessionManager` now persists flow-state snapshots (`lobby` / `in_round` / `results`) on each state revision.
   - Snapshot event IDs are idempotent (`{sessionId}:snapshot:{revision}`), so duplicate persistence attempts are no-ops.

3. **Idempotent leaderboard materialization + replay recovery**
   - `LeaderboardService.recordMatchResult` now supports event IDs and deduplicates writes by `eventId`.
   - Match-final events are persisted before materialization, and service startup replays persisted events to rebuild standings after restart.
   - Duplicate reprocessing of a previously committed match event returns `idempotent: true` without mutating standings.

## WIS-115 Transport/Auth Surface Update (2026-04-14)

1. **Authoritative HTTP transport entrypoints**
   - Added `HttpRoomTransport` as minimal network service around `SessionManager` lifecycle (`create`, `join`, `input`, `advance`, `disconnect`, `reconnect`, `complete`).
   - Runtime remains server-authoritative: simulation, scoring, sequence checks, and abuse limits still execute in existing core session logic.

2. **Authenticated player identity on input/reconnect/disconnect**
   - Join route now issues signed player auth token scoped to `{sessionId, playerId, exp}`.
   - Input/disconnect/reconnect routes require bearer auth token and derive player identity from token claims.
   - Reconnect path now enforces auth/player identity match before reconnect token consumption, preventing cross-player token misuse.

3. **Transport-level integration coverage**
   - Added end-to-end transport tests for connect -> input -> advance -> complete and reconnect identity enforcement.
   - Verification includes lifecycle + SLO telemetry emission through service route (no telemetry regression).

## WIS-208 Deterministic Sync/Reconciliation Update (2026-04-15)

1. **Authoritative sync gate on all mutating transport routes**
   - `input`, `disconnect`, `reconnect`, `advance`, and `complete` now require client sync anchor (`revision`, `tick`, `stateHash`).
   - Service blocks mutation when anchor diverges from authoritative room flow-state.

2. **Automatic resync payload on mismatch**
   - Sync mismatches return `409` (`error: "sync_mismatch"`) with structured `desync` metadata and `resync.flowState`.
   - FE can replace local state from response directly, then retry without extra round-trip.

3. **Desync telemetry for triage and anti-cheat signal quality**
   - Added `session.sync.desync_detected` event with room/player/action plus received vs authoritative revision/hash/tick.
   - Payload includes `tickDelta` and bounded reconciliation window (`maxAllowedTickDelta=2`) for alerting and diagnostics.

## WIS-210 Leaderboard Integrity Quarantine Update (2026-04-15)

1. **Duplicate-event fingerprint enforcement on leaderboard writes**
   - `LeaderboardService` now computes canonical payload fingerprints for each match-final `eventId` using `sessionId` + normalized leaderboard entries.
   - Duplicate `eventId` writes with matching fingerprint remain idempotent and non-mutating.

2. **Mismatch quarantine flow for duplicate event collisions**
   - Duplicate `eventId` writes with divergent fingerprints are quarantined (`event_payload_mismatch`) and never mutate standings.
   - Quarantine emits `leaderboard.integrity.mismatch_quarantined` with expected vs received signature/digest context for anti-cheat and reliability triage.

3. **Auditability and durable-baseline protection**
   - `leaderboard.write` now marks quarantine context (`quarantined`, `integrityReason`) for downstream analytics.
   - Durable match-final baseline remains original-first-write only; mismatched duplicates cannot overwrite persisted event state.

## WIS-511 Session Identity + Event Schema Registry v1 (2026-04-24)

1. **Versioned session-identity claim schema**
   - Added contract module `src/contracts/wis511-session-identity-event-schema-registry.ts`.
   - Locked identity token claims for player auth token to schema id `session.identity.player_auth_token.v1` (`v`, `sid`, `pid`, `exp`).
   - Added helpers to parse token payload claims (`parseSessionIdentityTokenClaimsV1`) and validate claims (`validateSessionIdentityTokenClaimsV1`).

2. **Versioned event schema registry**
   - Added `WIS511_EVENT_SCHEMAS` with per-event schema ids/versioning for lifecycle, input acceptance, leaderboard delta, flow-state, desync, transport degradation, and elimination telemetry.
   - Added deterministic payload validators (`validateEventPayload`) to gate contract drift.

3. **Analytics minimum-event release gate**
   - Added `WIS511_REQUIRED_ANALYTICS_EVENT_SET` to codify minimum authoritative analytics signals for release reliability.
   - Added `validateRequiredAnalyticsEventSet(events)` for required-signal completeness + payload-shape validation.
   - Published contract docs/fixture under `docs/ux/WIS-511-session-identity-event-schema-registry-v1.*`.

## WIS-516 Integrity Warm-Path Prep (2026-04-24)

1. **Provisional integrity constants are now code-level and flag-configurable**
   - Added `src/core/session-integrity.ts` with provisional defaults for intent-age guard, reject-burst escalation, desync escalation, tick-lag escalation, and movement invariant slack.
   - `SessionManager`, `MultiplayerSession`, and `AuthoritativeMatchSessionService` now accept `integrityConfig` overrides so WIS-514 can tune thresholds without structural code changes.

2. **Server-authoritative impossible-input/time-drift checks are wired**
   - Added strict input envelope rejection (`impossible_input`) in `MultiplayerSession.submitInput`.
   - Added intent-age rejection in `AuthoritativeMatchSessionService.processTick` (`TIM-003`).
   - Added repeated-reject and repeated-desync integrity escalation telemetry in `SessionManager`.

3. **Integrity telemetry contract path is live**
   - Emitting `session.integrity.violation` and `session.integrity.escalated` from authoritative runtime paths.
   - Added schema registry entries (`*.v1`) and updated fixture/docs so contract validation stays deterministic.

## SLO Alert Thresholds (Initial Defaults)

- Tick lag:
  - warn when `p95LagMs > 50`
  - critical when `p99LagMs > 100`
- Leaderboard writes:
  - warn when `p95LatencyMs > 25`
  - critical when `failureRate > 0.01` (1%)
- Reconnect reliability:
  - warn when `successRate < 0.98` over the observed attempt window
  - investigate reason buckets immediately when `token_expired` or `token_replayed` spikes relative to baseline

## Reliability / Integrity Tradeoffs (Current)

1. **State durability**
   - MVP now persists session snapshots and match-final events to a local durable file with replay recovery.
   - Remaining tradeoff: this is single-node durability, not a shared distributed store.
   - Follow-up needed on Redis/Postgres/event-log backing for multi-node runtime.

2. **Reconnect token security**
   - WIS-78 shipped cryptographic signing and replay protection for reconnect tokens.
   - Remaining tradeoff: token validation state is in-memory only and does not survive process restart.
   - CTO follow-up needed for shared/distributed token state if sessions move to multi-node runtime.

3. **Scoring model**
   - Score is currently derived from survival + height with elimination penalty.
   - Tradeoff: immediate leaderboard pipeline validation vs game-design-final correctness.
   - CTO review needed on canonical scoring contract and anti-cheat implications.

## Known Technical Debt

- Durability is local file-backed only; no distributed/shared persistence layer yet.
- Transport surface is HTTP-only; no WebSocket stream path yet.
- Player auth is in-process token verification only; no external identity provider / key rotation workflow yet.
- Input abuse limiting is in-memory per process and not yet distributed across nodes.
- No structured log exporter / metrics backend integration.
- No deterministic simulation cross-node replay harness.

## Next Hardening Steps

1. Move durability from local file to shared storage for multi-node failover.
2. Extend transport from HTTP baseline to production WebSocket/session fanout with distributed per-room rate limits.
3. Add replayable match transcript for anti-cheat verification.
4. Export SLO metrics/events to a production monitoring backend.
