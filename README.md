# Multiplayer Core Loop + Leaderboard Baseline

Baseline implementation for `WIS-65` covering:

- deterministic, server-authoritative room simulation
- reconnect and input-sequencing integrity checks
- leaderboard ingestion + sorted standings
- observability hooks for gameplay lifecycle and leaderboard writes

## Quick Start

```bash
npm install
npm test
npm run build
npm run dev
```

`npm run dev` executes a small end-to-end demo round and prints match + event counter output.

## Core Components

- `src/core/multiplayer-session.ts`
  - authoritative per-room simulation state
  - rising-ground acceleration and elimination checks
  - reconnect token handling
  - strict contiguous input sequence acceptance
- `src/core/session-manager.ts`
  - room lifecycle orchestration
  - simulation advancement and room completion scoring
  - telemetry event emission for lifecycle and input outcomes
- `src/leaderboard/leaderboard-service.ts`
  - match result ingestion
  - best-score persistence per player
  - sorted rank materialization
- `src/telemetry/event-sink.ts`
  - in-memory event stream for observability and diagnostics

## Verification

Current baseline verification commands:

- `npm test`
- `npm run build`

See `docs/verification-notes.md` for latest results.

## Notes

See `docs/implementation-note.md` for design decisions, known debt, and hardening priorities.
