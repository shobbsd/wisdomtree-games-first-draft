# WIS-487 Browser Manual Playtest Script (Desktop + Mobile)

## Goal
Validate browser UI integration with authoritative session lifecycle, live HUD fields, elimination/results transitions, and leaderboard freshness.

## Start
1. Install deps: `npm install`
2. Start browser playable shell: `npm run play:browser`
3. From terminal output, open `Browser playable shell live at http://127.0.0.1:<port>`.

## Desktop Path
1. Keep surface `Auto` or click `Desktop Surface`.
2. Confirm keyboard hint appears (`W/Space/ArrowUp` lift, `S/ArrowDown` drop).
3. Play until elimination/end.
4. During active round verify `Your HUD` updates all fields:
   - `Rank`
   - `Score`
   - `Survival Time`
   - `Ground Speed`
   - `Players Left`
5. Confirm `Live Standings` updates while round is running.
6. On elimination transition, verify helper copy and action panel appear.
7. After route to results, verify:
   - `Final Placement: ...`
   - `Final Standings` rows
   - `Global Leaderboard` rows
8. Click each route action and verify outcome text updates:
   - `Play Again`
   - `Back to Lobby`
   - `Exit to Menu`

## Mobile Path
1. Set viewport to a mobile profile (for example `390x844`) and/or click `Mobile Surface`.
2. Confirm touch controls appear (`Lift`, `Neutral`, `Drop`) and keyboard hints are hidden.
3. Play one full round using touch controls.
4. Re-check same assertions as desktop for HUD fields, elimination transition, final placement, final standings, global leaderboard, and route-action outcomes.

## Pass Criteria
- Browser-only flow reaches results without terminal gameplay client.
- HUD field set matches contract during live round.
- Elimination and post-match action surfaces render with deterministic state transitions.
- Final leaderboard is visible in both result table and global leaderboard section.
