# WIS-135: Rising-Ground Escalation + Elimination UX Contract

Date: 2026-04-14  
Owner: UXDesigner (`af8675f3-eeba-4bce-92c8-f6d9c88fa60d`)

## 1) Scope

In-match UX contract only, for state progression:
- `RG-NORMAL`
- `RG-WARNING`
- `RG-CRITICAL`
- `RG-ELIMINATED`

Contract defines:
- canonical event names
- player-facing copy (exact strings)
- timing budgets and dwell windows
- visibility/placement rules (desktop + mobile)
- pass/fail runtime checklist FE + CTO can validate

Out of scope:
- lobby/countdown UX
- reconnect-only flows not tied to rising-ground escalation
- post-match leaderboard degradation lifecycle

## 2) Audit Snapshot (Current Baseline)

Audit inputs:
- `docs/ux/WIS-124-gameplay-hud-leaderboard-states-v1.md`
- `docs/ux/WIS-85-match-entry-elimination-reconnect-ux-brief.md`
- `docs/ux/WIS-99-multiplayer-hud-results-audit.md`

Observed baseline:
- Existing docs define escalation intent and elimination copy, but event naming is not normalized across one runtime contract.
- Existing docs define danger tiers and overlays, but no single source locks trigger thresholds + timing budgets + surface priority in one table for runtime validation.
- Prior audit already flags missing/underspecified elimination transition runtime states in implementation contract (`F-07` in `WIS-99`).

Conclusion:
- Gap exists. FE/CTO need one explicit runtime UX contract for rising-ground escalation and elimination transitions.

## 3) Canonical Event Contract

All events below are required runtime-level events. Names are exact.

### 3.1 Event Names + Payload Minimum

| Event name | Required payload | Purpose |
|---|---|---|
| `rg.state.normal.enter` | `matchId`, `playerId`, `dangerTier="LOW"|"MED"`, `groundSpeedMultiplier`, `serverTs` | Enter/restore baseline safe state. |
| `rg.state.warning.enter` | `matchId`, `playerId`, `dangerTier="WARNING"`, `groundSpeedMultiplier`, `clearancePct`, `serverTs` | Enter elevated risk state. |
| `rg.state.critical.enter` | `matchId`, `playerId`, `dangerTier="CRITICAL"`, `groundSpeedMultiplier`, `clearancePct`, `serverTs` | Enter highest pre-elimination urgency state. |
| `rg.state.deescalate` | `matchId`, `playerId`, `fromTier`, `toTier`, `groundSpeedMultiplier`, `serverTs` | Return from warning/critical to lower risk tier. |
| `rg.elimination.triggered` | `matchId`, `playerId`, `cause="rising_ground"`, `survivalMs`, `rankAtElim`, `aliveAtElim`, `serverTs` | Authoritative elimination start event. |
| `rg.elimination.actions_shown` | `matchId`, `playerId`, `actions=["spectate","view_leaderboard"]`, `shownAtMs` | Confirms action panel visibility after impact phase. |
| `rg.elimination.auto_route` | `matchId`, `playerId`, `route="view_leaderboard"`, `trigger="timeout"`, `elapsedMs` | Confirms automatic fallback route after timeout. |

Rules:
- Escalation events are monotonic by severity unless `rg.state.deescalate` fired.
- `rg.elimination.triggered` must preempt all rank/activity toasts immediately.
- Repeated same-tier events within debounce window (`300ms`) are ignored for UI transitions.

## 4) UX State Contract (Normal -> Warning -> Critical -> Eliminated)

### 4.1 State Table

| State | Entry trigger | Exit trigger | Player copy (exact) | Timing budget | Visibility rules |
|---|---|---|---|---|---|
| `RG-NORMAL` | `rg.state.normal.enter` OR `rg.state.deescalate` to `LOW/MED` | `rg.state.warning.enter` OR `rg.state.critical.enter` OR `rg.elimination.triggered` | `Danger low. Keep climbing.` | Copy appears as status-line update for `1200ms` max; no blocking overlay | Keep in persistent HUD danger rail only. No center-screen interrupt. |
| `RG-WARNING` | `rg.state.warning.enter` | `rg.state.critical.enter`, `rg.state.deescalate`, or `rg.elimination.triggered` | `Ground rising faster. Move up.` | Warning banner render <= `150ms` from event receipt; min dwell `1500ms` unless preempted by critical/elimination | Non-modal warning banner + danger rail escalation. Allowed surfaces: top status strip (desktop), top compact strip (mobile). |
| `RG-CRITICAL` | `rg.state.critical.enter` | `rg.state.deescalate` or `rg.elimination.triggered` | `Critical danger. Climb now.` | Critical render <= `120ms`; min dwell `1800ms` unless eliminated; optional pulse cadence max `2Hz` | High-priority banner always visible. Must suppress rank-delta toast lane while active. Keep gameplay center unobstructed. |
| `RG-ELIMINATED` | `rg.elimination.triggered` with `cause="rising_ground"` | Player action (`spectate`/`view_leaderboard`) or `rg.elimination.auto_route` timeout | Phase 1: `Eliminated. Finalizing your placement...`  
Phase 2 cause line: `Rising ground caught you.`  
Action helper: `You can spectate now or view results.` | Impact phase `1200ms` (`ELIM-IMPACT`) then action phase (`ELIM-ACTIONS`) with auto-route timeout `6000ms` (`ELIM-AUTO-RESULTS`) | Full interrupt overlay. Lock gameplay input immediately. Show context stats (`rankAtElim`, `aliveAtElim`). Action order fixed: `Spectate` primary, `View Leaderboard` secondary. |

### 4.2 Immediate Next-Action Clarity (Elimination Required)

When `RG-ELIMINATED` active:
- Player always sees at least one actionable CTA by `+1200ms` from `rg.elimination.triggered`.
- If no interaction by `+6000ms` after CTA display, auto-route to leaderboard/results.
- CTA labels are locked:
  - `Spectate`
  - `View Leaderboard`

## 5) Surface and Breakpoint Visibility Rules

## 5.1 Desktop
- `RG-NORMAL`: danger rail text only; no large banner.
- `RG-WARNING`: warning banner in top status strip, does not cover play center.
- `RG-CRITICAL`: critical banner pinned in highest-priority HUD lane; rank toasts suppressed.
- `RG-ELIMINATED`: full-width interrupt panel allowed; inputs locked until CTA or auto-route.

## 5.2 Mobile
- `RG-NORMAL`: compact danger row only.
- `RG-WARNING`: single-line top warning strip; no multi-toast stacking.
- `RG-CRITICAL`: same lane as warning, elevated style; must remain readable within safe area.
- `RG-ELIMINATED`: modal/bottom-sheet interrupt allowed, but both CTAs visible without additional navigation.

## 5.3 Shared A11y Rules
- Every escalation state uses icon + text (not color only).
- `RG-WARNING`/`RG-CRITICAL`: announce via `aria-live="polite"`.
- `RG-ELIMINATED`: announce via `aria-live="assertive"`, move focus to heading on first frame.
- Reduced motion mode: disable pulse/shake, keep opacity transition <= `150ms`.

## 6) Deterministic Pass/Fail Checklist (FE + CTO)

Run in implementation workspace backing this issue.

1. Verify canonical events exist and are emitted:
```bash
rg "rg\.state\.normal\.enter|rg\.state\.warning\.enter|rg\.state\.critical\.enter|rg\.elimination\.triggered|rg\.elimination\.actions_shown|rg\.elimination\.auto_route" src tests
```
Pass if all event names found in runtime path + tests.

2. Verify exact escalation/elimination copy lock:
```bash
rg "Danger low\. Keep climbing\.|Ground rising faster\. Move up\.|Critical danger\. Climb now\.|Eliminated\. Finalizing your placement\.\.\.|Rising ground caught you\.|You can spectate now or view results\." src tests docs
```
Pass if exact strings present once in canonical copy source and wired references exist.

3. Verify timing constants:
- warning min dwell `1500ms`
- critical min dwell `1800ms`
- elimination impact `1200ms`
- elimination auto-route `6000ms`
Pass if constants + tests cover all four.

4. Runtime transition validation (manual or automated trace):
- Trigger progression `normal -> warning -> critical -> eliminated`.
- Confirm state ordering, copy updates, and preemption behavior.
- Confirm elimination shows CTA by `+1200ms` and auto-route by `+6000ms` without interaction.
Pass if all checks deterministic on desktop and mobile contract variants.

5. Visibility + suppression behavior:
- In `RG-CRITICAL`, rank toasts suppressed.
- In `RG-ELIMINATED`, gameplay input locked and action order fixed (`Spectate`, `View Leaderboard`).
Pass if both true in runtime behavior.

Fail criteria (any one fails):
- missing canonical event
- copy mismatch
- timing mismatch
- state ordering mismatch
- CTA timing/order mismatch
- desktop/mobile behavior divergence

## 7) FE/CTO Handoff Requirements

Any closeout comment on implementation ticket must include:
- evidence links/paths for event emission + tests
- copy source path and proof of exact string lock
- timing test evidence for 1500/1800/1200/6000 budgets
- short desktop/mobile parity note for this state chain

