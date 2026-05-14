# WIS-192 UAT Runtime + Deterministic Seed Runbook

## Goal

Provide reproducible UAT environment bootstrap and deterministic reset/seed flow for multiplayer sessions + leaderboard state.

## Runtime Profile

Default profile (override via env vars):

| Variable | Default | Purpose |
| --- | --- | --- |
| `UAT_HTTP_HOST` | `127.0.0.1` | HTTP bind host |
| `UAT_HTTP_PORT` | `4310` | HTTP bind port |
| `UAT_AUTH_TOKEN_SECRET` | `uat-local-auth-secret` | transport auth token signing secret |
| `UAT_AUTH_TOKEN_TTL_MS` | `3600000` | auth token ttl |
| `UAT_RUNTIME_DIR` | `.runtime/uat` | runtime artifacts directory |
| `UAT_DURABLE_STATE_FILE` | `.runtime/uat/durable-state.json` | durable seed/state file |
| `UAT_PID_FILE` | `.runtime/uat/server.pid` | server pid file (start/stop) |
| `UAT_LOG_FILE` | `.runtime/uat/server.log` | server log file |
| `UAT_STATUS_FILE` | `.runtime/uat/server-status.json` | runtime status snapshot |
| `UAT_SEED_SUMMARY_FILE` | `.runtime/uat/seed-summary.json` | deterministic seed summary output |

Inspect active profile:

```bash
npm run uat:profile
```

## Commands

```bash
npm run uat:reset  # canonical empty durable-state document
npm run uat:seed   # deterministic room + leaderboard seed (writes summary)
npm run uat:start  # start transport server in background and wait for health
npm run uat:stop   # stop background server and clean pid file
```

## Clean-Room UAT Spin-Up (<= 10 min)

1. Install deps once:

```bash
npm install
```

2. Reset + seed deterministic state:

```bash
npm run uat:reset
npm run uat:seed
```

3. Start UAT runtime:

```bash
npm run uat:start
```

4. Verify health:

```bash
curl -sS http://127.0.0.1:4310/health
```

Expected response:

```json
{"ok":true}
```

5. Stop runtime after session:

```bash
npm run uat:stop
```

## Deterministic Reset Between Rounds

Use this exact sequence between UAT rounds:

```bash
npm run uat:stop
npm run uat:reset
npm run uat:seed
npm run uat:start
```

No manual file edits required. Determinism signal is exposed in `.runtime/uat/seed-summary.json`:

- `roundsSeeded`
- `matchFinalEventCount`
- `sessionSnapshotCount`
- `durableStateSha256`

Repeated `uat:seed` runs on same profile produce byte-identical durable state.

## Seed Content

Deterministic seed profile includes two rounds:

- `uat-round-1` with 3 players and 4 deterministic advance ticks
- `uat-round-2` with 3 players and 3 deterministic advance ticks

Current reference digest from transcript run:

- `durableStateSha256 = b5a2dd4aad2d211f0e5f0d7c7725631a7dc34518865541629831a716792169bc`

## Evidence

- Command transcript: [docs/uat/WIS-192-uat-command-transcript.md](./WIS-192-uat-command-transcript.md)
- Automated determinism tests: `tests/uat-state-seed.test.ts`
