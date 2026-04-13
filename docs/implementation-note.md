# WIS-65 Implementation Note

## Architecture Decisions

1. **Authoritative simulation lives server-side in `MultiplayerSession`.**
   - Ground-rise, elimination, and input-order enforcement are all single-source-of-truth on the server model.
   - Session snapshots include a state hash to make desync detection possible in a later hardening pass.

2. **Session orchestration is isolated in `SessionManager`.**
   - Room creation/join/advance/complete concerns are separate from the simulation internals.
   - Completion converts authoritative session data into leaderboard-ready match records.

3. **Leaderboard is write-path first and in-memory for baseline speed.**
   - `LeaderboardService` keeps best score per player and exposes sorted standings.
   - Write events emit telemetry for downstream integrity/audit pipelines.

4. **Observability baseline is event-driven.**
   - `InMemoryEventSink` records lifecycle, input acceptance/rejection, and leaderboard writes.
   - This is intentionally simple but gives immediate signal quality for local iteration.

## Reliability / Integrity Tradeoffs (CTO Review Requested)

1. **State durability**
   - Current session and leaderboard stores are in-memory only.
   - Tradeoff: fast local iteration now vs process restart data loss.
   - CTO review needed on persistence target (Redis/Postgres/event log) and failure domain boundaries.

2. **Reconnect token security**
   - Tokens are deterministic and not cryptographically signed.
   - Tradeoff: low complexity baseline vs weaker anti-abuse guarantees.
   - CTO review needed on token signing, TTL policies, and replay hardening.

3. **Scoring model**
   - Score is currently derived from survival + height with elimination penalty.
   - Tradeoff: immediate leaderboard pipeline validation vs game-design-final correctness.
   - CTO review needed on canonical scoring contract and anti-cheat implications.

## Known Technical Debt

- No persistent storage layer for sessions, telemetry, or standings.
- No transport server (HTTP/WebSocket) yet; baseline is library/runtime-first.
- No rate limiting or auth for input submission path.
- No structured log exporter / metrics backend integration.
- No deterministic simulation cross-node replay harness.

## Next Hardening Steps

1. Add durable event log + leaderboard persistence.
2. Add authenticated transport surface with per-room rate limits.
3. Add replayable match transcript for anti-cheat verification.
4. Add reconnect token signing and explicit invalidation semantics.
5. Add SLO-focused observability (tick lag, reconnect success rate, leaderboard write latency/error budgets).
