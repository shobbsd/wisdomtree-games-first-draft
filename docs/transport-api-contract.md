# HTTP Transport API Contract (`WIS-115`)

This document defines the minimal network surface for the authoritative multiplayer runtime.

Base URL: `http://<host>:<port>`

## Browser Runtime Compatibility (`WIS-486`)

- All responses include CORS headers for local browser clients:
  - `access-control-allow-origin: *`
  - `access-control-allow-methods: GET,POST,OPTIONS`
  - `access-control-allow-headers`: always includes `authorization` and `content-type`, plus any requested preflight headers.
- `OPTIONS` preflight requests return `204` without requiring auth/session state.

## Auth Model

- Auth token is issued when player joins room.
- Client sends `Authorization: Bearer <authToken>` for player-scoped actions.
- Token is signed by service and bound to:
  - `sessionId`
  - `playerId`
  - expiry (`authTokenExpiresAtMs`)
- Reconnect also requires room-issued `resumeToken` from disconnect flow.

## Sync + Reconciliation Contract (`WIS-208`)

- All mutating routes (`input`, `disconnect`, `reconnect`, `advance`, `complete`) require a `sync` object in request body.
- `sync` fields:
  - `revision`: latest client-known flow-state revision
  - `tick`: latest client-known authoritative tick
  - `stateHash`: latest client-known authoritative world hash
- Server compares client sync against authoritative room flow-state before applying mutation.
- On mismatch, server blocks mutation and returns:
  - `409` + `error: "sync_mismatch"`
  - `desync` metadata (received vs authoritative revision/hash/tick)
  - `resync.flowState` full authoritative snapshot for client replacement
- Every mismatch emits telemetry event `session.sync.desync_detected` with structured mismatch context.

## Endpoints

### `POST /v1/rooms`

Create authoritative room.

Request body:

```json
{
  "sessionId": "room-123",
  "maxPlayers": 8,
  "nowMs": 0,
  "reconnectGraceMs": 30000,
  "playerInputRateLimitPerSecond": 20,
  "roomInputRateLimitPerSecond": 120,
  "inputRateWindowMs": 1000
}
```

`maxPlayers` is optional. When set, join attempts beyond capacity fail with `409` + `error: "room_full"`.

Response `201`:

```json
{
  "sessionId": "room-123",
  "sync": {
    "revision": 1,
    "tick": 0,
    "stateHash": "0000000000000000"
  }
}
```

### `POST /v1/rooms/:sessionId/players`

Join room + issue player auth token.

Request body:

```json
{
  "playerId": "alpha",
  "spawnHeight": 6,
  "nowMs": 0
}
```

Response `201`:

```json
{
  "sessionId": "room-123",
  "playerId": "alpha",
  "authToken": "<token>",
  "authTokenExpiresAtMs": 3600000,
  "sync": {
    "revision": 2,
    "tick": 0,
    "stateHash": "aabbccddeeff0011"
  }
}
```

### `POST /v1/rooms/:sessionId/input` (auth required)

Submit player input. Identity comes from bearer token (not request body).

Request body:

```json
{
  "sequence": 1,
  "thrust": 0.2,
  "nowMs": 10,
  "sync": {
    "revision": 3,
    "tick": 1,
    "stateHash": "abc123abc123abcd"
  }
}
```

Response `200` (accepted):

```json
{
  "accepted": true,
  "sync": {
    "revision": 3,
    "tick": 1,
    "stateHash": "abc123abc123abcd"
  }
}
```

Response `200` (rejected by authoritative guardrails):

```json
{
  "accepted": false,
  "reason": "stale",
  "sync": {
    "revision": 3,
    "tick": 1,
    "stateHash": "abc123abc123abcd"
  }
}
```

Possible `reason` values:
- `stale`
- `out_of_order`
- `missing_player`
- `disconnected`
- `eliminated`
- `rate_limited_player`
- `rate_limited_room`

### `POST /v1/rooms/:sessionId/disconnect` (auth required)

Disconnect authenticated player and issue reconnect token.

Request body:

```json
{
  "nowMs": 100,
  "sync": {
    "revision": 4,
    "tick": 2,
    "stateHash": "feedcafe12345678"
  }
}
```

### `POST /v1/rooms/:sessionId/leave` (auth required)

Alias of `disconnect` for explicit create/join/leave/reconnect client lifecycle handling.

Request and response payloads are identical to `/disconnect`.

Response `200`:

```json
{
  "playerId": "alpha",
  "resumeToken": "<resume-token>",
  "expiresAtMs": 30100,
  "sync": {
    "revision": 5,
    "tick": 2,
    "stateHash": "beefcafe12345678"
  }
}
```

### `POST /v1/rooms/:sessionId/reconnect` (auth required)

Reconnect authenticated player with resume token.

Request body:

```json
{
  "resumeToken": "<resume-token>",
  "nowMs": 220,
  "sync": {
    "revision": 6,
    "tick": 2,
    "stateHash": "9f9f9f9f9f9f9f9f"
  }
}
```

Response `200`:

```json
{
  "connected": true,
  "playerId": "alpha",
  "sync": {
    "revision": 7,
    "tick": 2,
    "stateHash": "1029384756abcdef"
  }
}
```

Failure responses:
- `401` when auth identity does not match token/session (`unknown_token`)
- `409` for replayed/expired reconnect token

### `POST /v1/rooms/:sessionId/onboarding/ack` (auth required)

Dismiss first-session onboarding cue for authenticated player.

Request body:

```json
{
  "cueId": "OB-QUEUE-FALLBACK",
  "nowMs": 220
}
```

Response `200`:

```json
{
  "acknowledged": true,
  "alreadyAcknowledged": false,
  "playerId": "alpha",
  "cueId": "OB-QUEUE-FALLBACK"
}
```

### `POST /v1/rooms/:sessionId/advance`

Advance room simulation tick.

Request body:

```json
{
  "deltaMs": 1000,
  "nowMs": 1000,
  "sync": {
    "revision": 7,
    "tick": 2,
    "stateHash": "1029384756abcdef"
  }
}
```

Response `200`:

```json
{
  "ok": true,
  "sync": {
    "revision": 8,
    "tick": 3,
    "stateHash": "abcdef0123456789"
  }
}
```

### `POST /v1/rooms/:sessionId/complete`

Finalize room, materialize leaderboard commit.

Request body:

```json
{
  "recordedAt": 1001,
  "sync": {
    "revision": 8,
    "tick": 3,
    "stateHash": "abcdef0123456789"
  }
}
```

Response `200`: leaderboard ingestion payload from `SessionManager.completeRoom` + final `sync`.

### `GET /v1/rooms/:sessionId/flow-state`

Fetch latest room flow-state snapshot for FE integration/debug.

Response `200`: `RoomFlowState` payload.

`uxState.onboarding` payload includes:

- `cueOrder` fixed onboarding sequence
- `byPlayerId` active cue per player (`null` when no active cue)

`leaderboard` payload (realtime UI contract) includes:

- `revision`: flow-state revision the leaderboard projection was derived from
- `tick`: authoritative simulation tick for the projection
- `snapshot`: full deterministic standings for active room players
- `updates`: incremental changes between previous and current projection (`joined`, `updated`, `left`)

`leaderboard.snapshot` ordering/tie-break precedence:

1. `score` descending
2. `survivalMs` descending
3. `playerId` lexicographic ascending (deterministic final tie-break)

Each `snapshot` row includes:
- `playerId`
- `rank`
- `score`
- `survivalMs`
- `connected`
- `isEliminated`
- `eliminationReason`
- `isTie`
- `placementToken` (`T-{rank}` when tied, otherwise `{rank}`)

### `GET /health`

Service health probe.

Response `200`:

```json
{
  "ok": true
}
```

## Error Contract

Error payload:

```json
{
  "error": "<machine_reason>",
  "message": "<human-readable detail, optional>"
}
```

Status conventions:
- `400`: invalid request payload
- `401`: auth missing/invalid or identity mismatch
- `404`: unknown route/session
- `409`: lifecycle conflict OR sync mismatch (`error: "sync_mismatch"`)
- `500`: unhandled runtime error

Machine-readable lifecycle reasons:
- `session_not_found`: room/session does not exist
- `room_full`: room capacity reached
- `room_closed`: room no longer accepts joins (`in_round` or `results`)
- `player_already_joined`: duplicate join attempt for same player ID
- `invalid_request`: payload validation failure
- `server_error`: unhandled runtime failure

`sync_mismatch` payload shape:

```json
{
  "error": "sync_mismatch",
  "action": "input",
  "desync": {
    "sessionId": "room-123",
    "playerId": "alpha",
    "reason": "revision_mismatch",
    "received": { "revision": 4, "tick": 1, "stateHash": "abc..." },
    "authoritative": { "revision": 6, "tick": 2, "stateHash": "def..." },
    "tickDelta": 1,
    "maxAllowedTickDelta": 2
  },
  "resync": {
    "flowState": { "...": "authoritative RoomFlowState snapshot" }
  }
}
```

## Telemetry Expectations

Service path preserves existing runtime telemetry via `SessionManager` and `LeaderboardService`, including:

- `session.lifecycle.*`
- `session.slo.tick_lag`
- `session.slo.reconnect_success_rate`
- `session.input.*`
- `session.sync.desync_detected`
- `session.leaderboard.updated`
- `leaderboard.*`
