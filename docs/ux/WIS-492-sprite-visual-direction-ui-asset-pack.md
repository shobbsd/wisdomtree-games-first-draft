# WIS-492 Sprite Visual Direction + UI Asset Pack

Date: 2026-04-23  
Owner: UXDesigner (`af8675f3-eeba-4bce-92c8-f6d9c88fa60d`)

## Goal
Define sprite style and implementation-facing asset contract for playable multiplayer platform MVP. Prioritize at-speed readability, elimination clarity, and low-friction FE integration.

## Global Art Direction
- Readability-first pixel style with strong silhouettes and dark outer contour on all gameplay entities.
- Palette split:
  - Player/friendly: cyan-green family.
  - Hazards/enemies: orange-red family.
  - Neutral terrain: stone/slate with high-value edge highlights.
  - Pickups: bright gold/teal emissive accents.
- Gameplay status clarity:
  - Local player always gets a `YOU` badge.
  - Eliminated state always gets an `OUT` badge.
  - Damage/hit state uses 2-frame flash + knockback smear.

## Scale + Grid Contract
- Terrain tile base: `16x16`.
- Character frame base: `24x24`.
- Recommended render scale:
  - Desktop: `2x`
  - Mobile: `2x` to `2.5x` (preserve legibility on small screens)

## Required Sprite States
- Player:
  - `idle(4)`, `run(6)`, `jump_up(1)`, `jump_down(1)`, `hit(2)`, `dead(4)`, `spawn(2)`
- Hazards:
  - Spike: `idle(1)`, `armed(2)`
  - Drone: `idle(2)`, `move(4)`, `hit(2)`
  - Rising ground: `loop(4)`
- Pickups:
  - Coin: `spin(8)`
  - Boost: `idle(4)`, `collect(2)`
- HUD basics:
  - Icon sheet, rank badges, elimination badges (`YOU`, `OUT`), warning badge, 9-slice panel slices

## File Contract (Production Paths)
- `assets/sprites/player/player_sheet.png`
- `assets/sprites/player/player_fx_sheet.png`
- `assets/sprites/hazards/spike_sheet.png`
- `assets/sprites/hazards/drone_sheet.png`
- `assets/sprites/hazards/rising_ground_sheet.png`
- `assets/sprites/terrain/terrain_tileset.png`
- `assets/sprites/terrain/bg_parallax_strip.png`
- `assets/sprites/pickups/coin_sheet.png`
- `assets/sprites/pickups/boost_sheet.png`
- `assets/ui/hud/hud_icons_sheet.png`
- `assets/ui/hud/hud_badges.png`
- `assets/ui/hud/hud_panels_9slice.png`

## Placeholder Contract (Drop-in Swap Paths)
- `assets/placeholders/player_sheet.placeholder.png`
- `assets/placeholders/player_fx.placeholder.png`
- `assets/placeholders/hazard_spike.placeholder.png`
- `assets/placeholders/hazard_drone.placeholder.png`
- `assets/placeholders/rising_ground.placeholder.png`
- `assets/placeholders/terrain_tileset.placeholder.png`
- `assets/placeholders/bg_parallax.placeholder.png`
- `assets/placeholders/pickup_coin.placeholder.png`
- `assets/placeholders/pickup_boost.placeholder.png`
- `assets/placeholders/hud_icons.placeholder.png`
- `assets/placeholders/hud_badges.placeholder.png`
- `assets/placeholders/hud_panels.placeholder.png`

## Naming + Integration Rules
- Lower-snake-case filenames, deterministic folders by domain (`player`, `hazards`, `terrain`, `pickups`, `ui/hud`).
- Animation state names stay canonical from "Required Sprite States" list.
- FE should wire now to production path constants; placeholder files remain temporary one-for-one swaps.
- No runtime resize logic per entity; use shared render scale multiplier for consistency.

## Coordination Note
Coordination with CTO track issue [WIS-491](/WIS/issues/WIS-491): implementation can wire placeholders immediately and switch to finals with same file paths to avoid integration churn.
