# WIS-448 Desktop/Mobile Playable FE Surface Evidence

## Scope

Close blocker from [WIS-447](/WIS/issues/WIS-447): provide executable FE-surface proof for desktop + mobile play paths, leaderboard freshness/legibility, and accessibility smoke signals.

## Exact Run Commands

```bash
node --import tsx scripts/generate-wis-448-evidence.ts
npm test -- tests/http-room-transport.test.ts tests/wis212-hud-readability-contract.test.ts tests/wis216-accessibility-baseline-contract.test.ts tests/wis97-critical-microcopy-lock.test.ts
```

Combined command transcript (with command lines + outputs):

- `docs/ux/evidence/WIS-448-desktop-mobile-playable-run.log`

## Evidence Artifacts

- `docs/ux/evidence/WIS-448-desktop-mobile-playable-surface.json`
- `docs/ux/evidence/WIS-448-desktop-mobile-playable-run.log`
- `scripts/generate-wis-448-evidence.ts` (deterministic evidence generator)

## Results Summary

From `docs/ux/evidence/WIS-448-desktop-mobile-playable-surface.json`:

- Desktop path (`keyboard_like`): 14-tick full round completed, final standings emitted, live HUD rank/score/survival fields updated each tick.
- Mobile path (`touch_tap`): 14-tick full round completed, final standings emitted, live HUD rank/score/survival fields updated each tick.
- Cross-surface checks: all pass
  - `bothRoundsComplete=true`
  - `bothShowLiveLeaderboardUpdates=true`
  - `bothPreserveSurfaceVisibilityContracts=true`
  - `bothCarryAccessibilitySmokeSignals=true`

### Leaderboard Freshness + Legibility

- Live leaderboard freshness: score deltas observed across ticks for target + opponent on both surfaces (`liveLeaderboardUpdatesObserved=true`).
- Legibility fields present on each tick for both surfaces:
  - `rank`
  - `score`
  - `survivalTime`
  - `groundSpeed`
  - `playersLeft`

### Accessibility Smoke

- Accessibility smoke signals present on both surfaces:
  - non-empty baseline acceptance checks (`acceptanceChecksCount=4`)
  - runtime `accessibility.hudAnnouncement` payload present each tick
  - focus-order contract payload present (`results/elimination/failure` slots)

## Residual Risks

- Evidence validates FE contract surface through transport + flow-state snapshots, not pixel-rendered browser screenshots.
- Human-control parity is modeled via deterministic keyboard/tap input patterns over authenticated transport requests rather than physical input-device capture.
