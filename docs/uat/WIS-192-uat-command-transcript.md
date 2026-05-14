# WIS-192 UAT Command Transcript

Date: 2026-04-15  
Timezone: Europe/London

## Commands + Outputs

### 1) Runtime profile inspection

```bash
npm run --silent uat:profile
```

Result (trimmed):

- host/port: `127.0.0.1:4310`
- durable state file: `.runtime/uat/durable-state.json`
- seed rounds: `uat-round-1`, `uat-round-2`
- command map: `uat:start`, `uat:stop`, `uat:reset`, `uat:seed`

### 2) Clean reset

```bash
npm run --silent uat:reset
```

Result:

```json
{
  "event": "uat_state_reset",
  "stateFilePath": ".../.runtime/uat/durable-state.json"
}
```

### 3) Deterministic seed

```bash
npm run --silent uat:seed
```

Result highlights:

- `roundsSeeded: 2`
- `matchFinalEventCount: 2`
- `sessionSnapshotCount: 17`
- standings emitted for 6 seeded players
- `durableStateSha256: b5a2dd4aad2d211f0e5f0d7c7725631a7dc34518865541629831a716792169bc`

### 4) Start service + health + stop

```bash
npm run --silent uat:start
curl -sS http://127.0.0.1:4310/health
npm run --silent uat:stop
```

Result:

```text
UAT server started (pid 80565) at http://127.0.0.1:4310
{"ok":true}
UAT server stopped (pid 80565)
```

## Acceptance Mapping

- Clean-room spin-up from zero state: satisfied by reset/seed/start/health flow.
- Deterministic reset without manual edits: satisfied by `uat:reset` + `uat:seed` commands.
- Evidence captured: this transcript + runbook + automated determinism test.

Related docs:

- [docs/uat/WIS-192-uat-runbook.md](./WIS-192-uat-runbook.md)
- `tests/uat-state-seed.test.ts`
