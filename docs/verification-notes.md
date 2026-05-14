# Verification Notes

Date: 2026-04-13
Run timestamp: 2026-04-13 14:00 (Europe/London)

## Commands

```bash
npm test
npm run build
npm run dev
```

## Results

- `npm test`
  - 6 test files passed
  - 30 total tests passed
- `npm run build`
  - TypeScript project compiled successfully
- `npm run dev`
  - end-to-end demo round completed
  - emitted final standings for `runner-a` (rank 1) and `runner-b` (rank 2)
  - emitted lifecycle + SLO + leaderboard telemetry counters

## Covered Behaviors

- deterministic rising-ground simulation and elimination
- contiguous input sequencing enforcement
- reconnect token grace-window behavior
- signed reconnect token integrity, replay rejection, and expiry invalidation semantics
- reconnect grace expiry elimination and timeout telemetry
- per-player/per-room input abuse limiting with explicit rate-limit telemetry
- leaderboard best-score retention and sorting
- authoritative tie rank tokens (`T-{rank}`) for shared placements
- rank-delta match commit payload for results-summary consumers
- anti-cheat scoring guardrail regression (tampered sequences rejected without score inflation)
- end-to-end room lifecycle -> leaderboard ingestion with telemetry hooks
- tick-lag SLO telemetry (`session.slo.tick_lag`) with rolling `p95LagMs` and `p99LagMs`
- reconnect SLO telemetry (`session.slo.reconnect_success_rate`) with reason breakdown (`connected`, `unknown_token`, `token_expired`, `token_replayed`)
- leaderboard write SLO telemetry (`leaderboard.slo.write_latency`) with latency percentiles and rolling failure rate
- durable session flow-state snapshot persistence to file-backed store
- idempotent leaderboard ingestion keyed by match-final `eventId`
- restart recovery by replaying persisted match-final events into in-memory leaderboard projection

## Critical Multiplayer Flow Smoke Checklist

- Room lifecycle and leaderboard commit path
  - evidence: `tests/core-loop-integration.test.ts`, `npm run dev`
- Authoritative simulation + elimination path
  - evidence: `tests/multiplayer-session.test.ts`
- Reconnect token integrity + replay protection + expiry handling
  - evidence: `tests/multiplayer-session.test.ts`, `tests/flow-state-contract.test.ts`
- Input sequencing and anti-cheat score integrity
  - evidence: `tests/multiplayer-session.test.ts`, `tests/flow-state-contract.test.ts`
- Priority alert/message channel behavior (P0/P1/P2 + queue fallback defaults)
  - evidence: `tests/priority-message-channel.test.ts`
- Post-match leaderboard ordering, tie placement tokens, and rank deltas
  - evidence: `tests/leaderboard-service.test.ts`
- Durable snapshot + event-first persistence and replay recovery
  - evidence: `tests/durability-recovery.test.ts`

## Alert Threshold Checks

Thresholds documented in `docs/implementation-note.md` were checked in test fixtures by asserting emitted metric fields and evaluating example scenarios:

- Tick lag thresholds (`p95 <= 50`, `p99 <= 100`)
  - test scenario produced `p95LagMs=30`, `p99LagMs=30` (within threshold)
- Leaderboard write thresholds (`p95LatencyMs <= 25`, `failureRate <= 0.01`)
  - success-path scenario emits `failureRate=0`
  - failure-path scenario emits `failureRate=1` to prove alert-signal path activates when writes fail
- Reconnect success-rate threshold (`successRate >= 0.98`)
  - mixed-attempt scenario emits `successRate=0.25` with explicit reason breakdown, validating degradation detection signal

## CI Release Gate (WIS-114)

Workflow file:

- `.github/workflows/ci-release-gate.yml`

Required status checks before merge/release:

- `ci-release-gate / microcopy-lock`
- `ci-release-gate / test-build`

Release guidance update:

- Do not merge release-bound code unless both required checks are green.
- If either check fails, release decision is automatically `no-go` until fixed and rerun.

## Policy Enforcement Record (WIS-125 / WIS-139)

Date: 2026-04-14
Run timestamp: 2026-04-14 12:05 (Europe/London)

Repository policy location:

- GitHub branch protection for `shobbsd/wisdomtree-games` branch `main`
- Endpoint: `PUT /repos/shobbsd/wisdomtree-games/branches/main/protection`

Applied required status checks:

- `ci-release-gate / microcopy-lock`
- `ci-release-gate / test-build`
- `strict=true` (require branches to be up to date before merge)
- `enforce_admins=true` (admins cannot bypass required checks)
- verification endpoint: `GET /repos/shobbsd/wisdomtree-games/branches/main/protection/required_status_checks`

Policy owner:

- CEO policy owner
- CTO (`shobbsd`) implementation owner/operator

Rollback path:

- Update protection via API and remove required contexts, or disable branch protection:
  - `PUT /repos/shobbsd/wisdomtree-games/branches/main/protection` with modified `required_status_checks`
  - `DELETE /repos/shobbsd/wisdomtree-games/branches/main/protection` for full rollback

Release decision enforcement:

- Merge/release to `main` is `no-go` when either required check is missing or failing.
- `strict=true` also blocks merge until the PR branch is up to date with `main`.

## UAT Reproducibility Record (WIS-192)

Date: 2026-04-15  
Run timestamp: 2026-04-15 12:34 (Europe/London)

Commands:

- `npm run --silent uat:profile`
- `npm run --silent uat:reset`
- `npm run --silent uat:seed`
- `npm run --silent uat:start`
- `curl -sS http://127.0.0.1:4310/health`
- `npm run --silent uat:stop`

Observed outcomes:

- deterministic seed emitted `roundsSeeded=2`, `matchFinalEventCount=2`, `sessionSnapshotCount=17`
- deterministic digest: `b5a2dd4aad2d211f0e5f0d7c7725631a7dc34518865541629831a716792169bc`
- UAT HTTP health endpoint returned `{"ok":true}`
- start/stop wrappers produced stable background lifecycle with pid-file cleanup

Evidence references:

- `docs/uat/WIS-192-uat-runbook.md`
- `docs/uat/WIS-192-uat-command-transcript.md`
- `tests/uat-state-seed.test.ts`

## WIS-210 Leaderboard Integrity + Quarantine Verification

Date: 2026-04-15  
Run timestamp: 2026-04-15 13:52 (Europe/London)

Commands:

- `npm test -- tests/leaderboard-service.test.ts`
- `npm test -- tests/durability-recovery.test.ts`
- `npm test -- tests/http-room-transport.test.ts`

Observed outcomes:

- mismatch duplicate `eventId` payload emits `leaderboard.integrity.mismatch_quarantined` and does not mutate standings
- durable replay baseline remains first-write event payload; mismatched duplicate stays quarantined
- canonical duplicate payload with reordered entries remains idempotent without false-positive quarantine
- transport sync mismatch gate coverage remains green (no regression from leaderboard integrity change)

Evidence references:

- `docs/ux/WIS-210-leaderboard-integrity-quarantine-spec.md`
- `docs/ux/evidence/WIS-210-leaderboard-integrity-audit.fixture.json`
- `docs/ux/evidence/WIS-210-leaderboard-integrity-validation.log`
- `tests/leaderboard-service.test.ts`
- `tests/durability-recovery.test.ts`
- `tests/http-room-transport.test.ts`

## WIS-218 Release Hardening Gate (Go/No-Go)

Date: 2026-04-15  
Final run timestamp: 2026-04-15 14:06 (Europe/London)

Gate outcome:

- `GO` at decision time
- CI gate `microcopy-lock`: pass
- CI gate `test-build` equivalent checks (`npm test`, `npm run build`): pass

Rollback drill scenario checks:

- sync mismatch path (`tests/http-room-transport.test.ts`): pass
- gameplay-loop determinism path (`tests/wis135-rising-ground-contract.test.ts` + `tests/wis209-rising-ground-determinism.test.ts`): pass
- leaderboard integrity/quarantine path (`tests/leaderboard-service.test.ts` + `tests/durability-recovery.test.ts`): pass

Evidence references:

- `docs/uat/WIS-218-release-hardening-gate.md`
- `.runtime/uat/WIS-218-hardening-gate-final.log`

## WIS-444 Playable Build Verification

Date: 2026-04-22  
Run timestamp: 2026-04-22 10:20 (Europe/London)

Commands:

- `npm test`
- `npm run build`
- `PLAYABLE_AUTO=1 PLAYABLE_TICK_MS=50 PLAYABLE_MAX_TICKS=12 npm run play`

Observed outcomes:

- all automated checks green (`17/17` test files, `80/80` tests)
- TypeScript build passes with no compile errors
- playable terminal loop runs end-to-end with live standings updates during active round
- rising-ground multiplier increases during live round (`x1.01` to `x1.14` in sampled run)
- round finalizes into leaderboard output without manual patching; final standings emitted for both live players

Evidence references:

- `src/playable/terminal-playable.ts`
- `src/playable/runtime-helpers.ts`
- `tests/playable-runtime.test.ts`
