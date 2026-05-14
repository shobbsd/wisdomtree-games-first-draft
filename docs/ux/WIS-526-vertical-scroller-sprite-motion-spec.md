# WIS-526 Vertical-Scroller Sprite + Motion Design Spec

Date: 2026-04-24
Owner: UXDesigner (`af8675f3-eeba-4bce-92c8-f6d9c88fa60d`)
Status: `done` (handoff-ready for CTO implementation)
Depends on: [WIS-521](/WIS/issues/WIS-521), [WIS-523](/WIS/issues/WIS-523), [WIS-492](/WIS/issues/WIS-492)

## Objective
Lock an implementation-ready sprite/motion spec for phase-2 vertical-scroller behavior: directional run, jump/fall readability, elimination clarity, and camera/control affordances that preserve upward readability under rising-hazard pressure.

## Internet Reference Synthesis (researched 2026-04-24)

| Reference | URL | Concrete pattern extracted | Adopt for WIS-526 |
| --- | --- | --- | --- |
| Downwell (Steam) | https://store.steampowered.com/app/360740/Downwell/ | Fast vertical progression with a small move set and high readability under speed. | Keep movement grammar small (`left/right/down/jump`) and prioritize silhouette + state legibility over animation complexity. |
| Icy Tower | https://en.wikipedia.org/wiki/Icy_Tower | Upward climb pressure is readability-first: jump cadence and momentum changes are instantly visible while pace increases. | Encode velocity shifts directly in sprite state priority (`jump_up`/`fall`/`land`) and avoid ambiguous in-between frames. |
| Doodle Jump | https://en.wikipedia.org/wiki/Doodle_Jump | Vertical camera framing keeps upcoming space readable while controls stay minimal. | Bias camera framing to show more space above player than below; keep HUD hints lightweight and action-first. |
| Jump King (Steam) | https://store.steampowered.com/app/1061090/Jump_King/ | Precision jumps and punishment for mistimed commits demand strict visual timing cues. | Add jump-buffer/coyote timing and a deterministic `land` recovery beat so commit/recovery windows are readable. |
| Celeste movement-forgiveness article | https://www.mattmakesgames.com/articles/celeste_and_forgiveness/index.html | Coyote time, jump buffering, and corner correction improve feel without lowering difficulty identity. | Include explicit timing tolerances and state transition guards in acceptance contract. |

## Motion Direction

- Readability target: player state must be identifiable in <=120ms at normal play speed.
- Animation complexity budget: keep core locomotion set to 7 states only (`idle`, `run_left`, `run_right`, `jump_up`, `fall`, `land`, `hit`, plus terminal `eliminated`).
- State priority (highest -> lowest): `eliminated` > `hit` > `land` > `jump_up` > `fall` > `run_left/run_right` > `idle`.
- Direction handling: `run_left` and `run_right` share one run strip and use horizontal flip for facing.
- Reduced-motion fallback: preserve state changes but cut non-essential camera shake and frame-rate modulation.

## Sprite State Contract

| State | Trigger | Exit | Animation spec | Notes |
| --- | --- | --- | --- | --- |
| `idle` | grounded, `abs(vx) < 0.08`, no `hit`, no `land` gate active | any movement/jump/hit/elimination trigger | 4 frames at 8 fps | Default breathing pose; high-contrast silhouette hold. |
| `run_left` | grounded, `vx <= -0.08` | `abs(vx) < 0.08`, jump, hit, elimination | 6 frames at 12 fps | Use shared run strip with `flipX=true`. |
| `run_right` | grounded, `vx >= 0.08` | `abs(vx) < 0.08`, jump, hit, elimination | 6 frames at 12 fps | Use shared run strip with `flipX=false`. |
| `jump_up` | airborne and `vy > 0.12` OR jump-start window (`0-120ms` after jump press) | `vy <= 0.12`, hit, elimination | 1 frame hold + optional 2-frame smear on first 80ms | Prioritize clear launch silhouette. |
| `fall` | airborne and `vy <= 0.12` | grounded (`land`), hit, elimination | 1 frame hold (map to `jump_down` art from [WIS-492](/WIS/issues/WIS-492)) | Distinct descending silhouette from `jump_up`. |
| `land` | transition airborne -> grounded after airborne duration >=120ms | after 90ms OR on immediate run/hit/elimination preemption | 2 frames at 16 fps (one-shot) | Mandatory recovery beat for readability. |
| `hit` | damage/elimination-prelude event while still alive | after 140ms OR hard-preempt by `eliminated` | 2 frames flash at 18 fps (one-shot) | Includes tint pulse and minor knockback cue. |
| `eliminated` | authoritative `isEliminated=true` | terminal until respawn/new round | 4 frames at 6 fps then freeze last frame | Lock controls and show elimination marker. |

### Forgiveness Timing Locks

- `coyoteTimeMs = 100` (jump still allowed shortly after leaving platform).
- `jumpBufferMs = 120` (buffer jump input shortly before landing).
- `cornerCorrectionPx = 6` (horizontal correction at platform lip on jump ascent).
- These values are gameplay+readability locks; do not ship with `0` defaults.

## Camera + Scene Guidance (Vertical Readability)

### Vertical framing

- Default anchor: player center at ~58% viewport height (more look-ahead space above than below).
- Soft zone: camera does not move while player stays within `42%-66%` vertical band.
- Hard catch-up: if player enters top `20%` or bottom `18%`, increase follow speed by 2.2x until back inside soft zone.
- Upward look-ahead: when `vy > 0.35`, add `+10%` viewport look-ahead up; decay over 150ms after apex.

### Horizontal framing

- Horizontal soft zone around center: `+-12%` viewport width.
- Look-ahead on run: shift camera `+-8%` toward facing direction when `abs(vx) >= 0.2`.
- Clamp so hazards + nearest landing platform remain visible; no snap cuts during normal traversal.

### Scene readability

- Keep hazard line visible in bottom `10%-15%` of screen at all times.
- Maintain platform-to-background luminance delta >= 35% for at-speed platform recognition.
- Reserve top HUD lane and do not allow camera/HUD overlap with jump trajectory cues.

## Control Affordance Contract (Up/Down/Left/Right + Jump)

### Desktop

- `A` / `ArrowLeft`: move left.
- `D` / `ArrowRight`: move right.
- `W` / `ArrowUp`: vertical intent up (ladder/climb context; if unavailable, camera peek-up only).
- `S` / `ArrowDown`: fast-fall and drop-through semisolid platforms.
- `Space`: jump.
- Combo rule: `Down + Jump` prioritizes drop-through when on semisolid; otherwise normal jump.

### Mobile

- Left thumb zone: `left` and `right` buttons.
- Right thumb zone: `up`, `down`, `jump` buttons.
- Button size lock: min `52px` touch target, min `8px` spacing.
- Input conflict resolution mirrors desktop precedence.

### HUD hint behavior

- First spawn, show 3 concise hints in sequence (max 1.8s each):
  - `Move: Left / Right`
  - `Jump: Space`
  - `Down + Jump: Drop Through`
- Context hint appears once when first semisolid is encountered.
- Suppress non-critical hints during `hit` and always suppress during `eliminated`.

## CTO Implementation Touchpoints

1. `src/types.ts`
- Extend input model for horizontal + vertical directional intent and discrete jump press.

2. `src/core/multiplayer-session.ts`
- Add directional kinematics + jump buffer/coyote handling.
- Emit deterministic motion flags used by FE state resolver (`grounded`, `vx`, `vy`, jump-start timestamp).

3. `src/playable/browser-shell.ts`
- Replace static player draw with state resolver implementing priority table above.
- Implement camera soft/hard zones and look-ahead values from this spec.
- Update control mapping and hint dock copy/priority behavior.

4. `docs/ux/evidence/`
- Add one deterministic tape JSON that demonstrates each state transition and camera catch-up case.

## Acceptance Checklist (CTO-implementable)

- `VS-01`: Given deterministic motion snapshots, FE state resolver returns exactly one sprite state per tick using declared priority order.
- `VS-02`: `run_left`/`run_right` use same animation strip with mirrored facing; no duplicate art requirement.
- `VS-03`: `land` fires only on airborne->grounded transition and lasts 90ms unless preempted by `hit`/`eliminated`.
- `VS-04`: `hit` preempts locomotion states immediately and cannot out-prioritize `eliminated`.
- `VS-05`: `coyoteTimeMs` and `jumpBufferMs` are both active and verified by deterministic tests.
- `VS-06`: Camera keeps player inside soft zone during normal traversal and uses hard catch-up only when crossing panic bounds.
- `VS-07`: Vertical look-ahead activates on upward velocity and decays smoothly after apex (no snap-back in <=1 frame).
- `VS-08`: Desktop + mobile both support `up/down/left/right + jump` mappings with the same conflict resolution order.
- `VS-09`: HUD hint sequence appears once per round and is suppressed in `eliminated` state.
- `VS-10`: Reduced-motion mode removes camera shake/non-essential pulses but preserves all state transitions and control affordances.
