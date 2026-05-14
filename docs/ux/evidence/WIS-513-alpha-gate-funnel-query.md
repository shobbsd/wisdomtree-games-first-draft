# WIS-513 Alpha Gate Funnel Event Contract

## Final event list (shipped)

- `session.onboarding.start`
- `session.onboarding.step_complete`
- `session.onboarding.complete`
- `session.onboarding.quit_before_first_full_round`

## Degraded-confidence correlation events for session notes

- `session.lifecycle.transport_connect_failed`
- `session.sync.desync_detected`

## Sample query path (warehouse recipe)

Assume telemetry warehouse table:

- `analytics.telemetry_events`
  - `event_type` (text)
  - `event_ts` (timestamp)
  - `payload` (json/jsonb)

```sql
WITH scoped AS (
  SELECT
    event_type,
    event_ts,
    payload,
    payload->>'sessionId' AS session_id,
    payload->>'playerId' AS player_id
  FROM analytics.telemetry_events
  WHERE event_type IN (
    'session.onboarding.start',
    'session.onboarding.step_complete',
    'session.onboarding.complete',
    'session.onboarding.quit_before_first_full_round',
    'session.lifecycle.transport_connect_failed',
    'session.sync.desync_detected'
  )
),
funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN event_type = 'session.onboarding.start' THEN player_id END) AS onboarding_start_players,
    COUNT(DISTINCT CASE WHEN event_type = 'session.onboarding.complete' THEN player_id END) AS onboarding_complete_players,
    COUNT(DISTINCT CASE WHEN event_type = 'session.onboarding.quit_before_first_full_round' THEN player_id END)
      AS early_quit_players
  FROM scoped
),
degraded AS (
  SELECT
    session_id,
    COUNT(*) FILTER (WHERE event_type = 'session.lifecycle.transport_connect_failed') AS transport_connect_failed_count,
    COUNT(*) FILTER (WHERE event_type = 'session.sync.desync_detected') AS desync_detected_count
  FROM scoped
  GROUP BY session_id
)
SELECT
  onboarding_start_players,
  onboarding_complete_players,
  ROUND(
    onboarding_complete_players::numeric / NULLIF(onboarding_start_players, 0),
    4
  ) AS onboarding_completion_rate,
  early_quit_players,
  ROUND(
    early_quit_players::numeric / NULLIF(onboarding_start_players, 0),
    4
  ) AS early_quit_rate_before_first_full_round
FROM funnel;
```

Session-note correlation join (example):

```sql
SELECT
  n.session_id,
  n.note_id,
  d.transport_connect_failed_count,
  d.desync_detected_count
FROM ux.session_notes n
LEFT JOIN degraded d ON d.session_id = n.session_id;
```
