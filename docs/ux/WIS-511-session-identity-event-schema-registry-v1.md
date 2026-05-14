# WIS-511 Session Identity + Event Schema Registry v1

This document defines the authoritative schema contract baseline for:

- session identity token claims (`player_auth_token`)
- elimination/rank-delta telemetry payloads
- degraded-confidence telemetry payloads
- required minimum analytics event set for release gating

Contract source of truth lives in:

- `src/contracts/wis511-session-identity-event-schema-registry.ts`
- `docs/ux/WIS-511-session-identity-event-schema-registry-v1.fixture.json`
- `docs/ux/evidence/WIS-511-schema-payload-samples.json` (runtime-generated payload samples for UX/QA gates)

## Registry Versioning

- Registry version: `1.0.0`
- Each event schema is versioned independently as `*.v1`.
- Identity token schema ID: `session.identity.player_auth_token.v1`

## Session Identity Token Claims (`v1`)

Canonical claims:

- `v`: literal `1`
- `sid`: non-empty session id string
- `pid`: non-empty player id string
- `exp`: positive integer epoch milliseconds

The claims payload can be decoded from the bearer token payload segment and validated with:

- `parseSessionIdentityTokenClaimsV1(token)`
- `validateSessionIdentityTokenClaimsV1(claims)`

## Event Schemas Included in v1

- `session.lifecycle.created.v1`
- `session.lifecycle.player_joined.v1`
- `session.input.accepted.v1`
- `session.leaderboard.updated.v1`
- `session.flow_state.updated.v1`
- `session.lifecycle.transport_connect_failed.v1`
- `session.sync.desync_detected.v1`
- `session.integrity.violation.v1`
- `session.integrity.escalated.v1`
- `rg.elimination.triggered.v1`

`session.leaderboard.updated.v1` is the canonical rank-delta payload surface. It includes:

- full leaderboard snapshot entries
- incremental updates with `rankDelta` and elimination metadata

Degraded-confidence telemetry is represented by:

- `session.lifecycle.transport_connect_failed.v1` (transport degradation)
- `session.sync.desync_detected.v1` (authority/client divergence)

## Required Minimum Analytics Event Set (Release Gate)

Release validation requires at least:

- one `session.lifecycle.created`
- one `session.lifecycle.player_joined`
- one `session.input.accepted`
- one `session.leaderboard.updated`
- one `rg.elimination.triggered`
- one degraded-confidence signal from:
  - `session.lifecycle.transport_connect_failed` OR
  - `session.sync.desync_detected`

Validation entrypoint:

- `validateRequiredAnalyticsEventSet(events)`

The validator returns:

- `missingRequirements[]` for unmet gate conditions
- `invalidEvents[]` with schema path errors when payloads violate contract
