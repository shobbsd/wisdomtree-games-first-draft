# WIS-73 Multiplayer State UX Implementation Acceptance Matrix

Source UX baseline: [WIS-62](/WIS/issues/WIS-62), especially [comment ae879cef](/WIS/issues/WIS-62#comment-ae879cef-3885-463e-8299-ba98dcb9fdf5).  
Implementation planning context: [WIS-67](/WIS/issues/WIS-67).  
Primary consumers: [WIS-72](/WIS/issues/WIS-72), [WIS-74](/WIS/issues/WIS-74), [WIS-75](/WIS/issues/WIS-75), [WIS-76](/WIS/issues/WIS-76).

This document converts approved UX flows into deterministic acceptance fixtures for frontend integration.

## Locked Defaults (Open Questions Closed)

### Queue fallback default wording

- Title: `Couldn’t find a match yet`
- Body: `Still searching for an open lobby. Retry now or create a room.`
- Primary CTA: `Retry`
- Secondary CTA: `Create Room`

### Reconnect copy defaults

- Lobby reserved slot state: `Reconnecting`
- Countdown interruption alert: `Player disconnected`
- In-match reconnect success toast: `Reconnected`
- In-match reconnect timeout terminal copy: `Disconnected`

### Tie display copy defaults

- Shared placement token format: `T-{rank}`
- Results card placement line: `Final Placement: T-{rank}`
- Leaderboard row label: `T-{rank}`

## State Model (MVP)

- `pre_match.queueing`
- `pre_match.lobby_ready`
- `pre_match.ready_check`
- `pre_match.countdown`
- `in_run.hud_active`
- `in_run.urgent_alert`
- `in_run.eliminated`
- `post_match.freeze`
- `post_match.results_summary`
- `post_match.leaderboard_snapshot`
- `post_match.route_choice`

## Event -> UI Response -> Copy Matrix

| Fixture ID | State | Event | UI response | Copy | Priority |
|---|---|---|---|---|---|
| PM-QUEUE-SUCCESS | `pre_match.queueing` | Quick Match queue success | Enter lobby and show roster + readiness statuses | `Joined Lobby` | P2 |
| PM-QUEUE-TIMEOUT | `pre_match.queueing` | Queue timeout at 8s | Show fallback module with `Retry` and `Create Room` actions | `Couldn’t find a match yet` + body default above | P1 |
| PM-MIN-PLAYERS-MET | `pre_match.lobby_ready` | Min-player threshold reached | Enable host `Start` CTA and keep non-host in ready state | `Ready to start` | P2 |
| PM-READY-CHECK-START | `pre_match.ready_check` | Host starts match or autostart trigger | Show 10s ready-check modal/banner | `Match starting in {t}` + `Confirm you’re ready` | P1 |
| PM-READY-CHECK-REMOVE | `pre_match.ready_check` | Player not ready at timeout | Remove player from current start, keep room membership | `You were removed from this start. Rejoin next round.` | P1 |
| PM-COUNTDOWN-INTERRUPT | `pre_match.countdown` | Drop before GO | Pause countdown up to 5s and re-evaluate gate | `Player disconnected` | P1 |
| PM-COUNTDOWN-RESUME | `pre_match.countdown` | Dropped player reconnects and gate remains valid | Resume countdown from paused state | `Match starting in {t}` | P1 |
| PM-COUNTDOWN-CANCEL | `pre_match.countdown` | Min players no longer met after pause | Cancel transition and return room to lobby ready state | `Need {n} players to start` | P1 |
| PM-COUNTDOWN-GO | `pre_match.countdown` | Countdown reaches zero | Render `3, 2, 1, GO` transition and lock pre-game controls | `GO` | P1 |
| IR-RANK-UP | `in_run.hud_active` | Rank increases | Toast under HUD with dwell 1.5s | `Rank Up: #{newRank}` | P1 |
| IR-RANK-DOWN | `in_run.hud_active` | Rank decreases | Toast under HUD with dwell 1.5s | `Rank Down: #{newRank}` | P1 |
| IR-HAZARD-THRESHOLD-1 | `in_run.urgent_alert` | Ground speed threshold 1 reached | P0 banner preempts P1/P2 | `Ground Rising Faster` | P0 |
| IR-HAZARD-THRESHOLD-2 | `in_run.urgent_alert` | Ground speed final threshold reached | Replace active hazard banner with terminal escalation | `Critical Rise Speed` | P0 |
| IR-LOW-CLEARANCE | `in_run.hud_active` | Elimination risk warning (non-terminal) | Show warning tier in HUD alert stack | `Low Clearance` | P1 |
| IR-JUMP-NOW | `in_run.urgent_alert` | Elimination imminent | Immediate center-top warning, preempt all lower priorities | `Jump Now` | P0 |
| IR-ELIMINATED | `in_run.eliminated` | Elimination committed | Lock controls and trigger post-match transition | `Eliminated` | P0 |
| IR-RECONNECT-SUCCESS | `in_run.hud_active` | Reconnect succeeds inside grace | Restore control and show toast | `Reconnected` | P2 |
| IR-RECONNECT-TIMEOUT | `in_run.eliminated` | Reconnect grace expires | Resolve elimination with disconnected reason | `Disconnected` | P1 |
| PO-MATCH-END-COMMIT | `post_match.freeze` | Match result committed | 0.8s freeze, winner highlight, then reveal summary card | `Match Complete` | P1 |
| PO-RESULTS-SUMMARY | `post_match.results_summary` | Summary card render | Show placement, rank delta, survival time, and actions | `Final Placement: #{placement}` | P1 |
| PO-TIE-RENDER | `post_match.leaderboard_snapshot` | Placement is tied | Render tie token in results + leaderboard rows | `T-{rank}` | P1 |
| PO-PLAY-AGAIN-HOST | `post_match.route_choice` | Host chooses `Play Again` | Re-enter ready-check in same lobby | `Play Again` | P2 |
| PO-BACK-TO-LOBBY | `post_match.route_choice` | Player chooses `Back to Lobby` | Return to current lobby without exiting room | `Back to Lobby` | P2 |
| PO-EXIT-MENU | `post_match.route_choice` | Player chooses `Exit to Menu` | Leave room and clear rematch intent | `Exit to Menu` | P2 |

## Parity Acceptance Notes (Desktop vs Mobile)

### Pre-match parity

- Queue timeout fallback contains identical copy and CTA set on desktop and mobile.
- Desktop roster is right rail; mobile roster is bottom-sheet drawer, but readiness status vocabulary is identical (`Ready`, `Not Ready`, `Reconnecting`).
- Countdown and ready-check lock timing (`T-3` lock, 5s disconnect pause cap) must be behaviorally identical across platforms.

### Urgent alert parity

- Priority ordering is identical on both platforms: P0 preempts P1 and P2; P1 does not block P0.
- Dwell time parity: P0 1.8s, P1 1.5s, P2 1.2s.
- Placement may differ for safe-area constraints, but top-most P0 alert must remain first visual focus on both platforms.

### Post-match parity

- Results card fields are mandatory on both platforms: placement, rank delta, survival time.
- Tie token formatting is identical (`T-{rank}`) in end-card and leaderboard contexts.
- CTA labels and action outcomes are identical even if layout changes (desktop row vs mobile stacked actions).

## Machine-Readable Fixture

Use [docs/multiplayer-state-ux-acceptance.fixture.json](./multiplayer-state-ux-acceptance.fixture.json) as the deterministic source for FE tests and contract checks.
