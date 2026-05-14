# WIS-116: Transport-State UX Acceptance Spec

## Objective
Define FE-ready UX acceptance for transport/connectivity degradation paths introduced by service-surface work, while preserving copy and parity locks already established in [WIS-95](/WIS/issues/WIS-95) and [WIS-97](/WIS/issues/WIS-97).

## Scope
- Initial transport connect failure before active room state resumes.
- In-run reconnect timeout terminal handling.
- Transient degraded service retry state in results commit lifecycle.
- Recovery confirmation after degraded-service retry succeeds.

## Locked Copy Sources
- Queue/connect fallback copy and CTA set from [WIS-97](/WIS/issues/WIS-97) (`copyLock.queueTimeout`).
- Reconnect timeout headline/body from [WIS-97](/WIS/issues/WIS-97) (`copyLock.hudAlerts.disconnected`, `criticalMicrocopyLock.keys.in_run.reconnect.failed_to_results`).
- Degraded retry + recovery copy from [WIS-95](/WIS/issues/WIS-95) and [WIS-104](/WIS/issues/WIS-104).

## Transport/Service State Contract

| State ID | Trigger | UX response | Exact copy | Priority | Exit condition |
|---|---|---|---|---|---|
| `TS-CONNECT-FAILED` | `transport_connect_failed` on join/resume handshake | Block ready-flow controls and render fallback module with retry CTAs | Title: `Couldn’t find a match yet`<br/>Body: `Still searching for an open lobby. Retry now or create a room.`<br/>Primary: `Retry`<br/>Secondary: `Create Room` | P1 | `transport_connected` succeeds, or player exits to menu |
| `TS-RECONNECT-TIMEOUT` | `player_reconnect_timeout` from service path (`token_expired`) | End reconnect attempt, lock gameplay input, route to elimination/results transition | Headline: `Disconnected`<br/>Detail: `Reconnect failed. You have been moved to results` | P0 terminal | Results screen mounted |
| `TS-SERVICE-DEGRADED-RETRYING` | `leaderboard_commit_retry_scheduled` while commit unresolved | Keep action row enabled and show retry status slot message with attempt token | Active: `Sync issue detected. Retrying leaderboard save ({attempt}/{maxAttempts})...`<br/>Delayed (>5000ms unresolved): `Still syncing leaderboard. Your result is safe and will appear soon.` | P1 | Commit success (`TS-SERVICE-RECOVERED`) or terminal failure (`RESULTS-FAILED`) |
| `TS-SERVICE-RECOVERED` | `leaderboard_commit_succeeded` after retry/degraded period | Show non-blocking confirmation toast and clear degraded status chip | `Leaderboard synced. Your placement is now confirmed.` | P2 | Toast dwell elapsed (`4000ms`) |

## Desktop/Mobile Parity Rules (FE Must Keep)
- Copy strings and token format are identical across desktop and mobile for all `TS-*` states.
- CTA labels/order for `TS-CONNECT-FAILED` remain `Retry` then `Create Room` on both platforms.
- Delayed retry copy swap threshold is identical (`5000ms`) on both platforms.
- Recovery toast duration is identical (`4000ms`) on both platforms.

## FE Verification Checklist (Explicit Pass/Fail)

| Check ID | Pass condition | Fail condition |
|---|---|---|
| `FE-TS-01` | `TS-CONNECT-FAILED` renders locked title/body/CTA labels exactly on desktop and mobile. | Any text drift, CTA rename, or platform-specific variant appears. |
| `FE-TS-02` | Pressing `Retry` re-attempts transport connect without leaving room context. | Retry does not dispatch connect attempt or forces unintended route reset. |
| `FE-TS-03` | Reconnect timeout path emits `Disconnected` and terminal detail copy before results handoff. | Timeout path uses generic error text or skips terminal copy prior to handoff. |
| `FE-TS-04` | Retrying degraded state renders active copy with `{attempt}/{maxAttempts}` interpolation. | Token placeholders leak raw or attempt metadata is omitted. |
| `FE-TS-05` | At `>5000ms` unresolved retry, copy swaps to delayed variant without changing state ID. | No swap occurs, wrong threshold, or state ID mutates unexpectedly. |
| `FE-TS-06` | On recovery, `TS-SERVICE-RECOVERED` toast appears for `4000ms` and degraded chip clears. | No recovery toast, incorrect dwell, or stale degraded indicator remains. |
| `FE-TS-07` | Behavior and copy sequencing match between desktop and mobile in connect-fail, timeout, degraded, and recovery flows. | Any order/timing/copy divergence between platforms. |

## Evidence Targets for Implementation Handoff
- Service transport integration tests in [WIS-115](/WIS/issues/WIS-115) (connect/reconnect failure path coverage).
- Results lifecycle assertions in `tests/flow-state-contract.test.ts`.
- UX fixture conformance using `docs/ux/WIS-116-transport-state-ux-acceptance.fixture.json`.
