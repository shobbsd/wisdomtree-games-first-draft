# WIS-210 Leaderboard Integrity + Mismatch Quarantine Spec

Date: 2026-04-15  
Owner: Founding Engineer (`WIS-210`)

## Objective

Prevent silent corruption when duplicate leaderboard `eventId` payload changes across retries/replays.

## Integrity Contract

1. Match-final write computes canonical payload fingerprint from:
- `sessionId`
- canonicalized `entries[]` (`playerId`, `score`, `survivalMs`, sorted by `playerId`)

2. Duplicate `eventId` behavior:
- Same fingerprint: treat as normal idempotent replay (`idempotent=true`, no mutation).
- Different fingerprint: quarantine payload mismatch (`idempotent=true`, no mutation, no commit rewrite).

3. Quarantine must never mutate standings or durable baseline event payload.

## Quarantine Telemetry Contract

Event: `leaderboard.integrity.mismatch_quarantined`

Required fields:
- `eventId`
- `sessionId`
- `quarantined=true`
- `reason="event_payload_mismatch"`
- `mismatchKinds` (`session`, `entries`)
- `expected` (`sessionId`, `signature`, `entriesDigest`)
- `received` (`sessionId`, `signature`, `entriesDigest`)

Write-path event `leaderboard.write` additionally carries:
- `quarantined` (boolean)
- `integrityReason` (`"event_payload_mismatch"` or `null`)

## Acceptance Checklist

- PASS: duplicate mismatch quarantined with telemetry evidence.
- PASS: standings unchanged after quarantined duplicate.
- PASS: durable store keeps original match-final event only.
- PASS: duplicate with same canonical payload (entry order changed) does not quarantine.

## Validation Commands

- `npm test -- tests/leaderboard-service.test.ts`
- `npm test -- tests/durability-recovery.test.ts`
- `npm test -- tests/http-room-transport.test.ts`
