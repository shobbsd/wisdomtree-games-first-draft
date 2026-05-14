# Multiplayer Core Loop + Leaderboard Baseline

Baseline implementation for `WIS-65` covering:

- deterministic, server-authoritative room simulation
- reconnect and input-sequencing integrity checks
- leaderboard ingestion + sorted standings
- durable event-first persistence with replay recovery
- observability hooks for gameplay lifecycle and leaderboard writes

## Quick Start

```bash
npm install
npm test
npm run build
npm run dev
npm run play
npm run play:browser
```

`npm run dev` executes a small end-to-end demo round and prints match + event counter output.
`npm run play` launches a playable terminal round (you vs bot) with live standings and final leaderboard.
`npm run play:browser` launches a browser-playable shell with desktop keyboard and mobile touch controls, including 4-way movement (`up/down/left/right`) plus platform run/jump sprite states.
Optional for scripted/fast runs: `PLAYABLE_AUTO=1 PLAYABLE_TICK_MS=100 PLAYABLE_MAX_TICKS=25 npm run play`.
Manual desktop/mobile verification script: `docs/ux/WIS-487-browser-playtest-script.md`.

## Core Components

- `src/core/multiplayer-session.ts`
  - authoritative per-room simulation state
  - rising-ground acceleration and elimination checks
  - signed reconnect token handling with replay rejection
  - strict contiguous input sequence acceptance
  - per-player/per-room input abuse rate limits
- `src/core/session-manager.ts`
  - room lifecycle orchestration
  - simulation advancement and room completion scoring
  - telemetry event emission for lifecycle, input outcomes, and abuse-limit rejects
  - durable flow-state snapshot persistence
- `src/transport/http-room-transport.ts`
  - minimal HTTP service surface around authoritative room lifecycle
  - signed player auth tokens for input/disconnect/reconnect paths
  - reconnect identity binding to prevent cross-player token misuse
- `src/leaderboard/leaderboard-service.ts`
  - match result ingestion
  - idempotent write materialization keyed by match event id
  - duplicate event-payload mismatch quarantine for integrity protection
  - restart-safe standings recovery via persisted event replay
- `src/persistence/file-durable-state-store.ts`
  - atomic file-backed store for session snapshots + match-final events
- `src/telemetry/event-sink.ts`
  - in-memory event stream for observability and diagnostics

## Verification

Current baseline verification commands:

- `npm test`
- `npm run build`

See `docs/verification-notes.md` for latest results.

## UAT Runtime + Deterministic Seed (WIS-192)

UAT operator commands:

- `npm run uat:profile`
- `npm run uat:reset`
- `npm run uat:seed`
- `npm run uat:start`
- `npm run uat:stop`

Runbook and evidence:

- `docs/uat/WIS-192-uat-runbook.md`
- `docs/uat/WIS-192-uat-command-transcript.md`

## Notes

See `docs/implementation-note.md` for design decisions, known debt, and hardening priorities.
See `docs/transport-api-contract.md` for FE integration contract on HTTP transport routes/auth.
See `docs/ux/WIS-511-session-identity-event-schema-registry-v1.md` for session identity token + analytics schema registry contracts.

For FE UX-integration acceptance fixtures from [WIS-73](/WIS/issues/WIS-73), see:

- `docs/multiplayer-state-ux-acceptance-matrix.md`
- `docs/multiplayer-state-ux-acceptance.fixture.json`

For transport/degraded service UX acceptance extension from [WIS-116](/WIS/issues/WIS-116), see:

- `docs/ux/WIS-116-transport-state-ux-acceptance-spec.md`
- `docs/ux/WIS-116-transport-state-ux-acceptance.fixture.json`
